// Who holds the keyboard inside the notebook, and the one request that has to
// outlive a render (issue #221).
//
// A cell's editor is asynchronous: starting to edit a rendered markdown cell
// unmounts the control that had focus, and Monaco appears several awaits later.
// The request is therefore kept here, by cell id, and the element claims it when
// it registers — after the editor has been resized, which is the earliest moment
// focusing it makes sense.
export interface Focusable {
  focus(): void;
}

export class NotebookFocus {
  private readonly elements = new Map<string, Focusable>();
  private pending: string | null = null;

  /** Focus the cell's current element, or the next one to register for it. */
  request(cellId: string): void {
    const element = this.elements.get(cellId);
    if (!element) {
      this.pending = cellId;
      return;
    }
    element.focus();
    this.pending = null;
  }

  /** Focus the element that is about to replace this cell's current one (Escape). */
  focusNext(cellId: string): void {
    this.pending = cellId;
  }

  /** A cell's control or editor exists; take the keyboard if this cell asked for it. */
  register(cellId: string, element: Focusable): void {
    this.elements.set(cellId, element);
    if (this.pending !== cellId) return;
    this.pending = null;
    element.focus();
  }

  unregister(cellId: string, element: Focusable): void {
    // Guarded so a late cleanup cannot delete the element a newer mount installed.
    if (this.elements.get(cellId) === element) this.elements.delete(cellId);
  }
}
