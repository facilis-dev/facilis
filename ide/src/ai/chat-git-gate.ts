// The paused clean-tree gate (D-181): the chat stops before the AI's first source write
// when the repository is missing, has no HEAD, or has uncommitted changes. The user chooses
// "commit and continue" or "stop"; nothing is written while the gate is pending.
//
// The card pre-fills a commit message generated from the diff (D-192): a small side call
// summarizes what the user's pending work does, at most 30 words. The textarea stays the
// user's: edits go through setMessage, and continue() commits exactly what it shows.
//
// Split out of ChatSession (which is at the 300-line limit). The class resolves the pause
// promise the turn loop awaits, and owns the turn Undo of the writes the AI made.

import type { ChatGitGateFailure, ChatState, GitSafety } from "./types";
import type { ChatWrites } from "./chat-writes";

/** What the gate needs from the session: state, emit, the git/write seams and the summarizer. */
export interface GitGateHost {
  emit(patch: Partial<ChatState>): void;
  state(): ChatState;
  host: { gitSafety?: GitSafety };
  writes: ChatWrites | null;
  /** Generate the default commit message from the pending diff; absent when unavailable. */
  generateMessage?: (failure: ChatGitGateFailure) => Promise<string>;
}

export class GitGateActions {
  private resolve: ((choice: "continue" | "stop") => void) | null = null;
  /** Bumped on every pause and on finish, so a late summarizer result cannot overwrite. */
  private generation = 0;
  private readonly deps: GitGateHost;

  constructor(deps: GitGateHost) {
    this.deps = deps;
  }

  /** Called by the turn loop: pause the turn until the user decides. */
  pause(failure: ChatGitGateFailure): Promise<"continue" | "stop"> {
    this.generation += 1;
    const generation = this.generation;
    const generating = this.deps.generateMessage !== undefined;
    this.deps.emit({ gitGate: { failure, message: "", generating, error: null } });
    if (generating) void this.generate(failure, generation);
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  /** The card's textarea: the user's edit wins over the generated default. */
  setMessage(message: string): void {
    const state = this.deps.state().gitGate;
    if (state === null || state.generating) return;
    this.deps.emit({ gitGate: { ...state, message } });
  }

  /** "Commit and continue": initialize the repository when missing, then commit everything. */
  async continue(message: string): Promise<void> {
    const state = this.deps.state().gitGate;
    const safety = this.deps.host.gitSafety;
    if (state === null || safety === undefined || this.resolve === null) return;
    if (state.failure.code === "no-repo") {
      const initialized = await safety.init();
      if (!initialized.ok) {
        this.showError(initialized.error);
        return;
      }
    }
    const committed = await safety.commitAll(message);
    if (!committed.ok) {
      this.showError(committed.error);
      return;
    }
    this.finish("continue");
  }

  /** "Stop": the turn ends without touching the project. */
  stop(): void {
    this.finish("stop");
  }

  /** Resolve a pending pause when the user cancels the turn (Stop button / new chat). */
  cancel(): void {
    this.finish("stop");
  }

  /** Undo the write tool's turn: restore exactly the paths it wrote from HEAD. */
  async undo(): Promise<void> {
    const writes = this.deps.writes;
    if (writes === null) return;
    const restored = await writes.undoTurn();
    if (!restored.ok) {
      this.deps.emit({
        error: {
          kind: "stream",
          message: restored.errors.length > 0 ? restored.errors.join("; ") : "Undo failed.",
        },
      });
      return;
    }
    this.deps.emit({ writes: [] });
  }

  private async generate(failure: ChatGitGateFailure, generation: number): Promise<void> {
    const generate = this.deps.generateMessage;
    if (generate === undefined) return;
    let message = "";
    try {
      message = await generate(failure);
    } catch {
      // The summarizer is a convenience; the card still opens with an editable textarea.
    }
    if (this.generation !== generation) return;
    const state = this.deps.state().gitGate;
    if (state === null) return;
    this.deps.emit({ gitGate: { ...state, message, generating: false } });
  }

  private finish(choice: "continue" | "stop"): void {
    this.generation += 1;
    const resolve = this.resolve;
    this.resolve = null;
    this.deps.emit({ gitGate: null });
    resolve?.(choice);
  }

  private showError(message: string): void {
    const state = this.deps.state().gitGate;
    if (state === null) return;
    this.deps.emit({ gitGate: { ...state, error: message } });
  }
}
