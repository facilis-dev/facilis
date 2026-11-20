// Zen mode (issue #57): the old "fullscreen" left the IDE layout via a fixed overlay; zen instead
// hides the floating HUD while the canvas keeps filling the tab. A tiny reducer so the enter/exit
// semantics are pure and testable; Esc exits (the panel wires the key).

export interface ZenState {
  readonly zen: boolean;
}

export type ZenAction =
  { readonly type: "toggle" } | { readonly type: "enter" } | { readonly type: "exit" };

export const INITIAL_ZEN: ZenState = { zen: false };

export function zenReducer(state: ZenState, action: ZenAction): ZenState {
  switch (action.type) {
    case "toggle":
      return { zen: !state.zen };
    case "enter":
      // Keep the reference when nothing changes so a re-render is not forced.
      return state.zen ? state : { zen: true };
    case "exit":
      return state.zen ? { zen: false } : state;
  }
}
