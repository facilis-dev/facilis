// Focus helper for the details surfaces (issue #59): closing a satellite or the sheet returns
// focus to the anchor card, so the keyboard never lands on the pane. React Flow renders every
// node wrapper with data-id; the lookup is scoped to the document because the card may sit in a
// different subtree than the dialog that closes.

export function focusGraphNode(anchorId: string): void {
  const element = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${CSS.escape(anchorId)}"]`,
  );
  element?.focus({ preventScroll: true });
}
