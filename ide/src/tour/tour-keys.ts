// The keys the guided tour owns while it is open (issue #218): Escape ends it, the arrows
// step it. The rule is pure and DOM-free so it is unit-tested; the overlay supplies the
// typing flag from the shared isTypingTarget() helper and the event's defaultPrevented.

/** What a tour key press asks the overlay to do; null means the key belongs elsewhere. */
export type TourKeyAction = "dismiss" | "next" | "previous" | null;

export interface TourKeyInput {
  readonly key: string;
  /** Another handler already consumed the event; the tour must not act on it too. */
  readonly defaultPrevented: boolean;
  /** An input, textarea, select or contenteditable has focus and keeps its own keys. */
  readonly typing: boolean;
}

export function tourKeyAction(input: TourKeyInput): TourKeyAction {
  if (input.defaultPrevented || input.typing) return null;
  switch (input.key) {
    case "Escape":
      return "dismiss";
    case "ArrowRight":
      return "next";
    case "ArrowLeft":
      return "previous";
    default:
      return null;
  }
}
