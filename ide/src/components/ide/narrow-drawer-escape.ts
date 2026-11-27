// The narrow drawer's Escape rule (issue #217), pure so it is unit-tested without a jsdom
// document: Escape belongs to a focused text field, and a handler that already consumed the
// key (a dialog or the graph ladder on top) must win. The caller resolves the two DOM facts.
export interface DrawerEscapeInput {
  key: string;
  defaultPrevented: boolean;
  /** isTypingTarget(event.target): an input, textarea, select or contenteditable. */
  typing: boolean;
}

export function drawerEscapeCloses({ key, defaultPrevented, typing }: DrawerEscapeInput): boolean {
  return key === "Escape" && !defaultPrevented && !typing;
}
