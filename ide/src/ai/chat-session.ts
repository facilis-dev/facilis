// The AI chat session: conversation state, streaming, proposal review and apply
// (D-045/D-046/D-047).
// One instance per controller (chat-host.ts keeps it in a WeakMap), so switching sidebar
// views keeps the conversation. Editor access is ChatHost, model access the injected call,
// and the VFS is reached only through chat-actions.ts — the validated applyPatch() path.
// Safety rule (invariant 9): the model never touches disk. A turn produces a reviewable
// proposal; only the user's Apply reaches applyPatch(), and a clean Apply can be undone.

import { applyAccepted, applyUndo } from "./chat-actions";
import { buildChatContext } from "./chat-context";
import { beginTraceRun, completeTraceRun } from "./chat-trace";
import { buildProposal } from "./chat-proposal";
import { callModel } from "./client";
import { TURN_IDLE, TURN_RESET, errorText, initialState, replayTurns } from "./chat-session-types";
import type { ChatHost, ChatSessionOptions, ModelCall } from "./chat-session-types";
import { openProjectInstructions } from "./instructions";
import { StreamAccumulator } from "./chat-stream";
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
  private readonly stream: StreamAccumulator;
  private listeners = new Set<() => void>();
  private state: ChatState;
  private controller: AbortController | null = null;
  private seq = 0;
  private cancelled = false;
  private streamId: string | null = null;
  constructor(host: ChatHost, options: ChatSessionOptions) {
    this.host = host;
    this.call = options.call ?? callModel;
    this.load = options.loadSettings ?? loadAiSettings;
    this.save = options.saveSettings ?? saveAiSettings;
    this.now = options.now ?? Date.now;
    this.runner = options.runner;
    this.stream = new StreamAccumulator(this.now);
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

  private status(patch: Partial<ChatState>): void {
    this.dropStream();
    this.emit(patch);
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
    this.resetStream();
    this.emit(initialState(this.state.settings));
  }

  cancel(): void {
    this.cancelled = true;
    this.controller?.abort();
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

  async send(text: string): Promise<void> {
    const content = text.trim();
    if (!content || this.state.phase !== "idle") return;
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
    this.resetStream();
    const messages = [...this.state.messages, this.nextMessage("user", content)];
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
      const built = await buildChatContext(this.host, abort.signal, {
        tools: this.runner.specs(),
      });
      if (abort.signal.aborted) return;
      this.emit({ context: built.context });
      const outcome = await runTurn({
        call: this.call,
        settings,
        system: built.system,
        messages: replayTurns(messages, HISTORY_LIMIT),
        host: this.host,
        signal: abort.signal,
        runner: this.runner,
        onText: (chunk) => this.streamChunk(chunk),
        onRepair: (attempt) => this.status({ repair: { attempt }, patchParts: null }),
        onScriptStart: (program, programNumber) =>
          this.emit({ exploring: programNumber, trace: beginTraceRun(this.state.trace, program) }),
        onScript: (result, program) =>
          this.emit({
            exploring: null,
            trace: completeTraceRun(this.state.trace, result, program),
          }),
        onPatches: (part) => this.status({ patchParts: { part } }),
      });
      if (this.cancelled) return;
      if (!outcome.ok) {
        this.dropStream();
        this.emit({ repair: null });
        this.fail(outcome.failure);
        return;
      }
      this.emit({ repair: null });
      const response = outcome.parsed.response;
      this.finishStream(response.message || "Done.");
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
        this.dropStream();
        this.fail({ kind: "stream", message: errorText(error) });
      }
    } finally {
      this.controller = null;
      const cancelled = this.cancelled;
      this.cancelled = false;
      this.resetStream();
      this.emit({
        phase: "idle",
        streaming: false,
        ...TURN_IDLE,
        ...(cancelled ? { error: { kind: "aborted", message: "Cancelled by the user." } } : {}),
      });
    }
  }

  /** Paint the growing `message` field into a bubble while the JSON streams in. */
  private streamChunk(chunk: string): void {
    const visible = this.stream.push(chunk);
    if (visible === null) return;
    if (this.streamId === null) {
      const message = this.nextMessage("assistant", visible);
      this.streamId = message.id;
      this.emit({ streaming: true, messages: [...this.state.messages, message] });
      return;
    }
    const id = this.streamId;
    this.emit({
      messages: this.state.messages.map((message) =>
        message.id === id ? { ...message, content: visible } : message,
      ),
    });
  }

  private finishStream(content: string): void {
    const id = this.streamId;
    this.streamId = null;
    this.emit({
      streaming: false,
      messages:
        id === null
          ? [...this.state.messages, this.nextMessage("assistant", content)]
          : this.state.messages.map((message) =>
              message.id === id ? { ...message, content } : message,
            ),
    });
  }

  private dropStream(): void {
    const id = this.streamId;
    this.streamId = null;
    this.emit({
      streaming: false,
      ...(id === null
        ? {}
        : { messages: this.state.messages.filter((message) => message.id !== id) }),
    });
  }

  private resetStream(): void {
    this.stream.reset();
    this.streamId = null;
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
