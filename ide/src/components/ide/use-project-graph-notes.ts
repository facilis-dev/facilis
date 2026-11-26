// The panel's note-editing layer (issue #194): the saved notes plus which one owns the open
// editor. Separate from useProjectGraphLayout so the panel can feed the Escape ladder without
// knowing the canvas, and so deleting the note being edited also closes its editor.

import { useCallback, useState } from "react";
import type { GraphPosition } from "@/facilis/graph-layout";
import type { GraphNote } from "@/facilis/graph-types";
import type { ProjectGraphLayout } from "./useProjectGraphLayout";

export interface ProjectGraphNoteState {
  readonly notes: readonly GraphNote[];
  readonly addNoteNonce: number;
  readonly editingNoteId: string | null;
  readonly noteEditing: boolean;
  readonly createNote: (position: GraphPosition) => string;
  readonly moveNote: (id: string, position: GraphPosition) => void;
  readonly editNote: (id: string, text: string) => void;
  readonly deleteNote: (id: string) => void;
  readonly startNoteEdit: (id: string | null) => void;
  readonly cancelNoteEdit: () => void;
  readonly requestAddNote: () => void;
  /** Empty-state fallback: create at a deterministic origin, then the surface mounts. */
  readonly createNoteHere: () => void;
}

export function useProjectGraphNotes(layout: ProjectGraphLayout): ProjectGraphNoteState {
  const [editingNoteIdState, setEditingNoteId] = useState<string | null>(null);
  // An AI reload can delete the note whose editor is open: report it closed instead of leaving
  // Escape cancelling a textarea that no longer exists.
  const editingNoteId =
    editingNoteIdState !== null && layout.notes.some((note) => note.id === editingNoteIdState)
      ? editingNoteIdState
      : null;
  const startNoteEdit = useCallback((id: string | null) => setEditingNoteId(id), []);
  const cancelNoteEdit = useCallback(() => setEditingNoteId(null), []);
  const createNoteHere = useCallback(() => {
    const id = layout.createNote({ x: 120, y: 120 });
    setEditingNoteId(id);
  }, [layout.createNote]);
  // Deleting the open note must close the editor too, or Escape would keep cancelling a
  // textarea that no longer exists.
  const deleteNote = useCallback(
    (id: string) => {
      layout.deleteNote(id);
      setEditingNoteId((current) => (current === id ? null : current));
    },
    [layout.deleteNote],
  );
  return {
    notes: layout.notes,
    addNoteNonce: layout.addNoteNonce,
    editingNoteId,
    noteEditing: editingNoteId !== null,
    createNote: layout.createNote,
    moveNote: layout.moveNote,
    editNote: layout.editNote,
    deleteNote,
    startNoteEdit,
    cancelNoteEdit,
    requestAddNote: layout.requestAddNote,
    createNoteHere,
  };
}
