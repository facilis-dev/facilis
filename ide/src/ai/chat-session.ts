// The AI chat session: conversation state plus the patch review/apply flow
// (D-045, D-046).
//
// One instance per controller (chat-host.ts keeps it in a WeakMap), so switching
// sidebar views does not lose the conversation. The session talks to the editor
// only through ChatHost and to the model only through an injected call: both stay
// fake-able in the unit tests, and neither the VFS write path nor the HTTP client
// grows a test-only branch.
//
// Safety rule (SPEC §9.3 / invariant 9): the model never touches disk. A turn
// produces a reviewable proposal; only the user's Apply reaches applyPatch(), which
// validates the patches before writing through the kernel.

import { applyPatch, type PatchBridge } from "@/facilis/apply-patch";
import { callModel, type CallModelInput, type CallModelResult } from "./client";
import { buildChatContext } from "./chat-context";
import { buildProposal } from "./chat-proposal";
import { parseAiResponse } from "./response";
import { isConfigured, loadAiSettings, saveAiSettings } from "./settings";
import type { AiChatTurn, AiSettings, ChatFailure, ChatMessage, ChatState } from "./types";

/** Turns replayed to the model on the next message. SPEC §9.1 Model A is one
 *  context block per turn; a long transcript only adds cost. */
const HISTORY_LIMIT = 20;

/** What the chat needs from the editor, all in project-relative terms. */
export interface ChatHost {
  /** Absolute VFS path of the open project, or null. */
  root(): string | null;
  bridge: PatchBridge;
  /** Project-relative paths of every file in the project. */
  files(): readonly string[];
  /** Read a project-relative file; "" when it does not exist. */
  read(path: string): Promise<string>;
  /** The file open in the editor, with unsaved buffer content when it is available. */
  activeFile(): Promise<{ path: string; content: string } | null>;
  /** Preview base URL used for /__facilis/manifest, or null when nothing runs. */
  manifestBase(): string | null;
  /** Reveal a project-relative path in the editor. */
  openFile(path: string): void;
}

export type ModelCall = (input: CallModelInput) => Promise<CallModelResult>;

export interface ChatSessionOptions {
  /** Injected by the tests; the real provider client by default. */
  call?: ModelCall;
  loadSettings?: () => AiSettings | null;
  saveSettings?: (settings: AiSettings) => void;
  now?: () => number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function initialState(settings: AiSettings | null): ChatState {
  return {
    phase: "idle",
    messages: [],
    proposal: null,
    applied: null,
    error: null,
    settings,
    configured: isConfigured(settings),
    context: null,
  };
}

export class ChatSession {
  private readonly host: ChatHost;
  private readonly call: ModelCall;
  private readonly load: () => AiSettings | null;
  private readonly save: (settings: AiSettings) => void;
  private readonly now: () => number;
  private listeners = new Set<() => void>();
  private state: ChatState;
  private controller: AbortController | null = null;
  private seq = 0;
  private cancelled = false;

  constructor(host: ChatHost, options: ChatSessionOptions = {}) {
    this.host = host;
    this.call = options.call ?? callModel;
    this.load = options.loadSettings ?? loadAiSettings;
    this.save = options.saveSettings ?? saveAiSettings;
    this.now = options.now ?? Date.now;
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

  private nextMessage(role: ChatMessage["role"], content: string, detail?: string): ChatMessage {
    this.seq += 1;
    return detail === undefined
      ? { id: role + "-" + this.seq, role, content, at: this.now() }
      : { id: role + "-" + this.seq, role, content, at: this.now(), detail };
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
    this.emit({
      phase: "idle",
      messages: [],
      proposal: null,
      applied: null,
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
    this.emit({
      phase: "sending",
      messages: [...this.state.messages, this.nextMessage("user", content)],
      proposal: null,
      applied: null,
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
        messages: this.history(),
        signal: abort.signal,
      });
      if (this.cancelled) return;
      if (!result.ok) {
        this.fail(result.failure);
        return;
      }
      await this.finish(result.text);
    } catch (error) {
      if (!this.cancelled) this.fail({ kind: "stream", message: errorText(error) });
    } finally {
      this.controller = null;
      const cancelled = this.cancelled;
      this.cancelled = false;
      this.emit({
        phase: "idle",
        ...(cancelled ? { error: { kind: "aborted", message: "Cancelled by the user." } } : {}),
      });
    }
  }

  /** Turn a parsed answer into an assistant message plus an optional proposal. */
  private async finish(text: string): Promise<void> {
    const parsed = parseAiResponse(text);
    if (!parsed.ok) {
      const detail = [parsed.error, ...parsed.issues].filter(Boolean).join("\n");
      this.emit({ error: { kind: "parse", message: detail } });
      return;
    }
    const response = parsed.response;
    this.emit({
      messages: [
        ...this.state.messages,
        this.nextMessage("assistant", response.message || "Done."),
      ],
    });
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

  /** Write the accepted files through the same validated path as the dev handle. */
  async apply(): Promise<void> {
    const proposal = this.state.proposal;
    const root = this.host.root();
    if (!proposal || !root || this.state.phase !== "idle") return;
    const patches = proposal.files.filter((file) => file.accepted).map((file) => file.patch);
    if (patches.length === 0) return;
    this.emit({ phase: "applying", error: null });
    try {
      const manifestBase = this.host.manifestBase();
      const result = await applyPatch({
        bridge: this.host.bridge,
        root,
        patches,
        ...(manifestBase === null ? {} : { manifestBase }),
      });
      this.emit({
        phase: "idle",
        applied: {
          ok: result.ok,
          written: result.written,
          deleted: result.deleted,
          errors: result.errors,
          revision: result.revision,
        },
        ...(result.ok ? { proposal: null } : {}),
      });
    } catch (error) {
      this.emit({ phase: "idle", error: { kind: "stream", message: errorText(error) } });
    }
  }

  private history(): AiChatTurn[] {
    return this.state.messages
      .filter((message) => message.content.length > 0)
      .slice(-HISTORY_LIMIT)
      .map((message) => ({ role: message.role, content: message.content }));
  }
}
