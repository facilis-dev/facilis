// The destructive-schema confirmation (D-193): the turn paused because a write would drop a
// table or a column, so the user applies it or cancels the turn. The class resolves the promise
// the turn loop awaits; nothing is written while the card is up.
//
// Attached to the session like GitGateActions, because both are pauses the UI answers.

import type { ChatState } from "./types";

export interface SchemaConfirmHost {
  emit(patch: Partial<ChatState>): void;
  state(): ChatState;
}

export class SchemaConfirmActions {
  private resolve: ((choice: "apply" | "cancel") => void) | null = null;
  private readonly deps: SchemaConfirmHost;

  constructor(deps: SchemaConfirmHost) {
    this.deps = deps;
  }

  /** Called by the turn loop: pause the turn until the user decides. */
  pause(changes: readonly string[]): Promise<"apply" | "cancel"> {
    this.deps.emit({ schemaConfirm: changes });
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  /** "Apply": the write the turn paused on lands. */
  apply(): void {
    this.finish("apply");
  }

  /** "Cancel", and the Stop button / new chat: the turn ends without writing. */
  cancel(): void {
    this.finish("cancel");
  }

  private finish(choice: "apply" | "cancel"): void {
    const resolve = this.resolve;
    if (resolve === null) return;
    this.resolve = null;
    this.deps.emit({ schemaConfirm: null });
    resolve(choice);
  }
}
