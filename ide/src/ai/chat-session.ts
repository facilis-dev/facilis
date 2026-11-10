// The AI chat session: conversation state, streaming, proposal review and apply
// (D-045/D-046/D-047).
// One instance per controller (chat-host.ts keeps it in a WeakMap), so switching sidebar
// views keeps the conversation. Editor access is ChatHost, model access the injected call,
// and the VFS is reached only through chat-actions.ts — the validated applyPatch() path.
// Safety rule (invariant 9): the model never touches disk. A turn produces a reviewable
// proposal; only the user's Apply reaches applyPatch(), and a clean Apply can be undone.

import { applyAccepted, applyUndo } from "./chat-actions";
import { buildChatContext } from "./chat-context";
import { compactConversation, replayWithSummary } from "./chat-compaction";
import { turnHooks } from "./chat-turn-hooks";
import { buildProposal } from "./chat-proposal";
import { callModel } from "./client";
import { TURN_IDLE, TURN_RESET, errorText, initialState } from "./chat-session-types";
import type { ChatHost, ChatSessionOptions, ModelCall } from "./chat-session-types";
import { openProjectInstructions } from "./instructions";
import { ChatStreamWriter } from "./chat-stream";
import type { PtcRunner } from "./ptc/protocol";
import { runTurn } from "./turn";
import { isConfigured, loadAiSettings, saveAiSettings } from "./settings";
import type { AiSettings, ChatFailure, ChatMessage, ChatState } from "./types";

export type { ChatHost, ChatSessionOptions, ModelCall } from "./chat-session-types";

const HISTORY_LIMIT = 20; // Turns replayed to the model on the next message (SPEC §9.1).

export class ChatSession {
  private readonly host: ChatHost;
  private readonly call: ModelCall;
  private readonly load: () => AiSettings | null;
  private readonly save: (settings: AiSettings) => void;
  private readonly now: () => number;
  private readonly runner: PtcRunner;
  private readonly stream: ChatStreamWriter;
  private listeners = new Set<() => void>();
  private state: ChatState;
  private controller: AbortController | null = null;
  private seq = 0;
  private cancelled = false;
  constructor(host: ChatHost, options: ChatSessionOptions) {
    this.host = host;
    this.call = options.call ?? callModel;
    this.load = options.loadSettings ?? loadAiSettings;
    this.save = options.saveSettings ?? saveAiSettings;
    this.now = options.now ?? Date.now;
    this.runner = options.runner;
    this.stream = new ChatStreamWriter(this.now, {
      messages: () => this.state.messages,
      next: (role, content) => this.nextMessage(role, content),
      emit: (patch) => this.emit(patch),
    });
    this.state = initialState(this.load());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ChatState => this.state;

  private emit(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch };
    // Set iteration tolerates a listener unsubscribing mid-notify; React never subscribes here.
    for (const listener of this.listeners) listener();
  }

  private nextMessage(role: ChatMessage["role"], content: string): ChatMessage {
    this.seq += 1;
    return { id: role + "-" + this.seq, role, content, at: this.now() };
  }

  private fail(failure: ChatFailure): void {
    this.emit({ error: failure });
  }

  saveSettings(settings: AiSettings): void {
    this.save(settings);
    this.emit({ settings, configured: isConfigured(settings) });
  }

  newChat(): void {
    this.controller?.abort();
    this.controller = null;
    this.cancelled = false;
    this.stream.reset();
    this.emit(initialState(this.state.settings));
  }

  cancel(): void {
    this.cancelled = true;
    this.controller?.abort();
  }

  /**
   * O-018: one model call summarizes the conversation; the next send replays the summary
   * instead of the covered messages. The transcript stays visible, only state changes.
   */
  async compact(): Promise<void> {
    const settings = this.state.settings;
    if (this.state.phase !== "idle") return;
    if (settings === null || !this.state.configured) {
      this.fail({ kind: "unsupported", message: "No AI provider configured." });
      return;
    }
    const messages = this.state.messages;
    // Nothing new since the last summary: do not spend a call re-summarizing the same text.
    const from = this.state.summary?.through ?? 0;
    if (!messages.slice(from).some((message) => message.content.length > 0)) return;

    this.cancelled = false;
    this.stream.reset();
    this.emit({ phase: "compacting", error: null });
    const abort = new AbortController();
    this.controller = abort;
    const outcome = await compactConversation({
      call: this.call,
      now: this.now,
      settings,
      messages,
      summary: this.state.summary,
      signal: abort.signal,
    });
    // A new chat superseded this call: its own state must stand (newChat reset it).
    if (this.controller !== abort) return;
    this.controller = null;
    const cancelled = this.cancelled;
    this.cancelled = false;
    this.emit({
      phase: "idle",
      ...(cancelled ? { error: { kind: "aborted", message: "Cancelled by the user." } } : {}),
    });
    if (cancelled) return;
    if ("failure" in outcome) this.fail(outcome.failure);
    else this.emit({ summary: outcome.summary });
  }

  openFile = (path: string): void => this.host.openFile(path);

  async openInstructions(): Promise<void> {
    const error = await openProjectInstructions(this.host);
    if (error !== null) this.fail({ kind: "stream", message: error });
  }

  toggleFile(path: string): void {
    const proposal = this.state.proposal;
    if (!proposal) return;
    this.emit({
      proposal: {
        ...proposal,
        files: proposal.files.map((file) =>
          file.patch.path === path ? { ...file, accepted: !file.accepted } : file,
        ),
      },
    });
  }

  discard(): void {
    if (!this.state.proposal) return;
    this.emit({ proposal: null, applied: null });
  }

  async send(text: string, images: readonly string[] = []): Promise<void> {
    const content = text.trim();
    if ((content.length === 0 && images.length === 0) || this.state.phase !== "idle") return;
    const settings = this.state.settings;
    if (!settings || !this.state.configured) {
      this.fail({ kind: "unsupported", message: "No AI provider configured." });
      return;
    }
    if (!this.host.root()) {
      this.fail({ kind: "unsupported", message: "No project folder is open." });
      return;
    }

    this.cancelled = false;
    this.stream.reset();
    const user = this.nextMessage("user", content);
    // A pasted screenshot (D-113) rides on the user's bubble; an image-only message has no text.
    const messages = [...this.state.messages, images.length > 0 ? { ...user, images } : user];
    this.emit({
      phase: "sending",
      messages,
      proposal: null,
      applied: null,
      undo: null,
      streaming: false,
      ...TURN_RESET,
      error: null,
    });
    const abort = new AbortController();
    this.controller = abort;
    try {
      // D-118: the project's MCP servers are discovered before the tool list is assembled.
      await this.host.prepare?.();
      const built = await buildChatContext(this.host, abort.signal, {
        tools: this.runner.specs(),
      });
      if (abort.signal.aborted) return;
      this.emit({ context: built.context });
      const outcome = await runTurn({
        call: this.call,
        settings,
        system: built.system,
        messages: replayWithSummary(messages, this.state.summary, HISTORY_LIMIT),
        host: this.host,
        signal: abort.signal,
        runner: this.runner,
        onText: (chunk) => this.stream.chunk(chunk),
        // D-110: the status lines, the program rows and the model-call rows are wired in
        // chat-turn-hooks.ts, which reads this session's current state.
        ...turnHooks({
          trace: () => this.state.trace,
          reasoning: () => this.state.reasoning,
          emit: (patch) => this.emit(patch),
          dropStream: () => this.stream.drop(),
        }),
      });
      if (this.cancelled) return;
      if (!outcome.ok) {
        this.stream.drop();
        this.emit({ repair: null });
        this.fail(outcome.failure);
        return;
      }
      this.emit({ repair: null });
      const response = outcome.parsed.response;
      this.stream.finish(response.message || "Done.");
      if (response.patches.length > 0) {
        this.emit({
          proposal: await buildProposal(
            response.patches,
            response.notes,
            response.requiresConfirmation,
            (path) => this.host.read(path),
            outcome.parsed.validation,
          ),
        });
      }
    } catch (error) {
      if (!this.cancelled) {
        this.stream.drop();
        this.fail({ kind: "stream", message: errorText(error) });
      }
    } finally {
      this.controller = null;
      const cancelled = this.cancelled;
      this.cancelled = false;
      this.stream.reset();
      this.emit({
        phase: "idle",
        streaming: false,
        ...TURN_IDLE,
        ...(cancelled ? { error: { kind: "aborted", message: "Cancelled by the user." } } : {}),
      });
    }
  }

  /** Write the accepted files through the validated path. */
  async apply(): Promise<void> {
    const proposal = this.state.proposal;
    const root = this.host.root();
    if (!proposal || !root || this.state.phase !== "idle") return;
    if (!proposal.files.some((file) => file.accepted)) return;
    this.emit({ phase: "applying", error: null });
    try {
      const { applied, undo } = await applyAccepted(
        { bridge: this.host.bridge, root, manifestBase: this.host.manifestBase() },
        proposal,
        this.host,
      );
      this.emit({ phase: "idle", applied, undo, ...(applied.ok ? { proposal: null } : {}) });
    } catch (error) {
      this.emit({ phase: "idle", error: { kind: "stream", message: errorText(error) } });
    }
  }

  /** Put the last clean Apply back the way it was. */
  async undo(): Promise<void> {
    const undo = this.state.undo;
    const root = this.host.root();
    if (!undo || !root || this.state.phase !== "idle") return;
    this.emit({ phase: "applying", error: null });
    try {
      const applied = await applyUndo(
        { bridge: this.host.bridge, root, manifestBase: this.host.manifestBase() },
        undo,
      );
      this.emit({ phase: "idle", applied, undo: applied.ok ? null : undo });
    } catch (error) {
      this.emit({ phase: "idle", error: { kind: "stream", message: errorText(error) } });
    }
  }
}
