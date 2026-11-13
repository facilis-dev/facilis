// The paused clean-tree gate (D-181): the chat stops before the AI's first source write
// when the repository is missing, has no HEAD, or has uncommitted changes. The user chooses
// "commit and continue" or "stop"; nothing is written while the gate is pending.
//
// Split out of ChatSession (which is at the 300-line limit). The class resolves the pause
// promise the turn loop awaits, and owns the turn Undo of the writes the AI made.

import type { ChatGitGateFailure, ChatState, GitSafety } from "./types";
import type { ChatWrites } from "./chat-writes";

/** What the gate needs from the session: state, emit, and the git/write seams. */
export interface GitGateHost {
  emit(patch: Partial<ChatState>): void;
  state(): ChatState;
  host: { gitSafety?: GitSafety };
  writes: ChatWrites | null;
}

export class GitGateActions {
  private resolve: ((choice: "continue" | "stop") => void) | null = null;
  private readonly deps: GitGateHost;

  constructor(deps: GitGateHost) {
    this.deps = deps;
  }

  /** Called by the turn loop: pause the turn until the user decides. */
  pause(failure: ChatGitGateFailure): Promise<"continue" | "stop"> {
    this.deps.emit({ gitGate: { failure, error: null } });
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  /** "Commit and continue": initialize the repository when missing, then commit everything. */
  async continue(): Promise<void> {
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
    const committed = await safety.commitAll();
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

  private finish(choice: "continue" | "stop"): void {
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
