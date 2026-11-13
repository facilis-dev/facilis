// The AI chat session: conversation state, streaming, proposals and the validated write
// tools (D-045/D-046/D-047, D-181). One instance per conversation (chat-host.ts keeps the
// per-controller ChatStore); editor access is ChatHost and the VFS only through
// chat-actions.ts and chat-writes.ts, where every write is validated first (invariant 9).

import { applyProposal, undoProposal } from "./chat-apply";
import { buildChatContext } from "./chat-context";
import { GitGateActions } from "./chat-git-gate";
import { compactConversation, replayWithSummary } from "./chat-compaction";
import { turnHooks } from "./chat-turn-hooks";
import { buildProposal, toggleProposalFile } from "./chat-proposal";
import type { ChatWrites } from "./chat-writes";
import { callModel } from "./client";
import { TURN_RESET, errorText, initialState, turnEnded } from "./chat-session-types";
import type { ChatHost, ChatSessionOptions, ModelCall } from "./chat-session-types";
import { openProjectInstructions } from "./instructions";
import { ChatStreamWriter } from "./chat-stream";
import type { PtcRunner } from "./ptc/protocol";
import { runTurn } from "./turn";
import { isConfigured, loadAiSettings, saveAiSettings } from "./settings";
import { ChatQueue } from "./chat-queue";
import type { AiSettings, ChatMessage, ChatState } from "./types";

export type { ChatHost, ChatSessionOptions, ModelCall } from "./chat-session-types";

const HISTORY_LIMIT = 20; // Turns replayed to the model on the next message (SPEC §9.1).

export class ChatSession {
  private readonly host: ChatHost;
  private readonly call: ModelCall;
  private readonly load: () => AiSettings | null;
  private readonly save: (settings: AiSettings) => void;
  private readonly now: () => number;
  private readonly runner: PtcRunner;
  private readonly writes: ChatWrites | null;
  /** The paused clean-tree gate and the write-tools turn Undo (D-181). */
  readonly gitGate: GitGateActions;
  private readonly stream: ChatStreamWriter;
  private readonly queue: ChatQueue;
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
    this.writes = options.writes ?? null;
    this.stream = new ChatStreamWriter(this.now, {
      messages: () => this.state.messages,
      next: (role, content) => this.nextMessage(role, content),
      emit: (patch) => this.emit(patch),
    });
    this.queue = new ChatQueue((queued) => this.emit({ queued }), this.now);
    this.state = initialState(this.load());
    this.gitGate = new GitGateActions({
      emit: (patch) => this.emit(patch),
      state: () => this.state,
      host: this.host,
      writes: this.writes,
    });
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

  /** A turn can end on its own (or be aborted), so the session drains the queue, not the UI. */
  private drainQueued(): void {
    if (this.state.phase !== "idle") return;
    const next = this.queue.shift();
    if (next !== null) void this.send(next.text, next.images);
  }

  saveSettings(settings: AiSettings): void {
    this.save(settings);
    this.emit({ settings, configured: isConfigured(settings) });
  }

  newChat(): void {
    this.gitGate.cancel();
    this.controller?.abort();
    this.controller = null;
    this.cancelled = false;
    this.stream.reset();
    this.queue.clear();
    this.emit(initialState(this.state.settings));
  }

  cancel(): void {
    this.gitGate.cancel();
    this.cancelled = true;
    this.controller?.abort();
  }

  removeQueued = (id: string): void => this.queue.remove(id);

  /**
   * O-018: one model call summarizes the conversation; the next send replays the summary
   * instead of the covered messages. The transcript stays visible, only state changes.
   */
  async compact(): Promise<void> {
    const settings = this.state.settings;
    if (this.state.phase !== "idle") return;
    if (settings === null || !this.state.configured) {
      this.emit({ error: { kind: "unsupported", message: "No AI provider configured." } });
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
    if ("failure" in outcome) this.emit({ error: outcome.failure });
    else this.emit({ summary: outcome.summary });
    // Settle the compaction first; a message queued while it ran starts only then.
    this.drainQueued();
  }

  openFile = (path: string): void => this.host.openFile(path);

  async openInstructions(): Promise<void> {
    const error = await openProjectInstructions(this.host);
    if (error !== null) this.emit({ error: { kind: "stream", message: error } });
  }

  toggleFile(path: string): void {
    const proposal = toggleProposalFile(this.state.proposal, path);
    if (proposal !== null) this.emit({ proposal });
  }

  discard(): void {
    if (!this.state.proposal) return;
    this.emit({ proposal: null, applied: null });
  }

  async send(text: string, images: readonly string[] = []): Promise<void> {
    const content = text.trim();
    if (content.length === 0 && images.length === 0) return;
    // A message typed mid-turn is queued instead of dropped; drainQueued() sends it on idle.
    if (this.state.phase !== "idle") {
      this.queue.push(content, images);
      return;
    }
    const settings = this.state.settings;
    if (!settings || !this.state.configured) {
      this.emit({ error: { kind: "unsupported", message: "No AI provider configured." } });
      return;
    }
    if (!this.host.root()) {
      this.emit({ error: { kind: "unsupported", message: "No project folder is open." } });
      return;
    }

    this.cancelled = false;
    this.writes?.beginTurn();
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
        ...(this.writes === null ? {} : { writes: this.writes }),
        pauseGitGate: (failure) => this.gitGate.pause(failure),
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
        this.emit({ error: outcome.failure });
        return;
      }
      this.emit({ repair: null, writes: this.writes?.turnWrites() ?? [] });
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
        this.emit({ error: { kind: "stream", message: errorText(error) } });
      }
    } finally {
      this.controller = null;
      const cancelled = this.cancelled;
      this.cancelled = false;
      this.stream.reset();
      // The turn is over (answer, failure or abort): its activity moves onto the user message
      // that opened it, so the transcript keeps the work above its answer across later turns.
      this.emit({
        phase: "idle",
        streaming: false,
        writes: this.writes?.turnWrites() ?? [],
        ...turnEnded(this.state.messages, user.id, this.state.trace),
        ...(cancelled ? { error: { kind: "aborted", message: "Cancelled by the user." } } : {}),
      });
      // An error or abort must not lose the rest of the queue (only a new chat clears it).
      this.drainQueued();
    }
  }

  /** Write the accepted files through the validated path (chat-apply.ts). */
  async apply(): Promise<void> {
    await applyProposal(this.host, this.state, (patch) => this.emit(patch));
    this.drainQueued();
  }

  /** Put the last clean Apply back the way it was (chat-apply.ts). */
  async undo(): Promise<void> {
    await undoProposal(this.host, this.state, (patch) => this.emit(patch));
    this.drainQueued();
  }
}
