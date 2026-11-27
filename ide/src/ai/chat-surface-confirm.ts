// The declared-capability confirmation (D-226, #234): the turn paused because a write adds a
// non-standard capability, so the user confirms the declarations — potentially rewording a
// reason — or declines. The class resolves the promise the turn loop awaits; nothing is
// written while the card is up.
//
// Attached to the session like SchemaConfirmActions, because both are pauses the UI answers.

import type { SurfaceRequest } from "@facilis.dev/ai";

import type { SurfaceDecision } from "./turn-writes";
import type { ChatState } from "./types";

export interface SurfaceConfirmHost {
  emit(patch: Partial<ChatState>): void;
  state(): ChatState;
}

export class SurfaceConfirmActions {
  private resolve: ((decision: SurfaceDecision) => void) | null = null;
  private readonly deps: SurfaceConfirmHost;

  constructor(deps: SurfaceConfirmHost) {
    this.deps = deps;
  }

  /** Called by the turn loop: pause the turn until the user decides. */
  pause(requests: readonly SurfaceRequest[]): Promise<SurfaceDecision> {
    this.deps.emit({ surfaceConfirm: requests });
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  /** "Confirm": the write lands, with the reasons the card collected. */
  confirm(reasons: Readonly<Record<string, string>> = {}): void {
    this.finish({ kind: "confirm", reasons });
  }

  /** "Cancel", and the Stop button / new chat: the pending write is dropped. */
  cancel(): void {
    this.finish({ kind: "cancel" });
  }

  private finish(decision: SurfaceDecision): void {
    const resolve = this.resolve;
    if (resolve === null) return;
    this.resolve = null;
    this.deps.emit({ surfaceConfirm: null });
    resolve(decision);
  }
}
