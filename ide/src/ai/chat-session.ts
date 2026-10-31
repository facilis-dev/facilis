// The AI chat session: conversation state, streaming, proposal review and apply
// (D-045/D-046/D-047).
//
// One instance per controller (chat-host.ts keeps it in a WeakMap), so switching
// sidebar views keeps the conversation. The session talks to the editor only
// through ChatHost, to the model only through an injected call, and to the VFS
// only through chat-actions.ts — the validated applyPatch() path.
//
// Safety rule (SPEC §9.3 / invariant 9): the model never touches disk. A turn
// produces a reviewable proposal; only the user's Apply reaches applyPatch(), and
// a clean Apply can be undone because the proposal kept the before-images.

import { applyAccepted, applyUndo } from "./chat-actions";
import { buildChatContext } from "./chat-context";
import { buildProposal } from "./chat-proposal";
import { callModel } from "./client";
import { errorText, initialState, replayTurns } from "./chat-session-types";
import type { ChatHost, ChatSessionOptions, ModelCall } from "./chat-session-types";
import { openProjectInstructions } from "./instructions";
import { StreamAccumulator } from "./chat-stream";
import { parseAiResponse } from "./response";
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
  private readonly stream: StreamAccumulator;
  private listeners = new Set<() => void>();
  private state: ChatState;
  private controller: AbortController | null = null;
  private seq = 0;
  private cancelled = false;
  /** The assistant bubble the stream is filling, when it has started. */
  private streamId: string | null = null;

  constructor(host: ChatHost, options: ChatSessionOptions = {}) {
    this.host = host;
    this.call = options.call ?? callModel;
    this.load = options.loadSettings ?? loadAiSettings;
    this.save = options.saveSettings ?? saveAiSettings;
    this.now = options.now ?? Date.now;
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
    // Set iteration tolerates a listener that unsubscribes while it runs; React
    // never subscribes synchronously from inside a store notification.
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
    this.resetStream();
    this.emit({
      phase: "idle",
      messages: [],
      proposal: null,
      applied: null,
      undo: null,
      streaming: false,
      error: null,
      context: null,
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.controller?.abort();
  }

  openFile(path: string): void {
    this.host.openFile(path);
  }

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
    this.emit({
      phase: "sending",
      messages: [...this.state.messages, this.nextMessage("user", content)],
      proposal: null,
      applied: null,
      undo: null,
      streaming: false,
      error: null,
    });
    const abort = new AbortController();
    this.controller = abort;
    try {
      const built = await buildChatContext(this.host, abort.signal);
      if (abort.signal.aborted) return;
      this.emit({ context: built.context });
      const result = await this.call({
        settings,
        system: built.system,
        messages: replayTurns(this.state.messages, HISTORY_LIMIT),
        signal: abort.signal,
        onText: (chunk) => this.streamChunk(chunk),
      });
      if (this.cancelled) return;
      if (!result.ok) {
        this.dropStream();
        this.fail(result.failure);
        return;
      }
      await this.finishAnswer(result.text);
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

  /** Turn a complete answer into the final bubble plus an optional proposal. */
  private async finishAnswer(text: string): Promise<void> {
    const parsed = parseAiResponse(text);
    if (!parsed.ok) {
      this.dropStream();
      const detail = [parsed.error, ...parsed.issues].filter(Boolean).join("\n");
      this.emit({ error: { kind: "parse", message: detail } });
      return;
    }
    const response = parsed.response;
    this.finishStream(response.message || "Done.");
    if (response.patches.length === 0) return;
    this.emit({
      proposal: await buildProposal(
        response.patches,
        response.notes,
        response.requiresConfirmation,
        (path) => this.host.read(path),
      ),
    });
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
