// Ref-stabilized card actions for the project-graph canvas: the collapse and note callbacks
// travel through refs so node data does not depend on the parent's function identity — a parent
// re-render must not rebuild the cards mid-drag or interrupt a note edit. Extracted from
// ProjectGraphCanvas when the data lens (issue #70) pushed it past the 300-line limit.

import { useCallback, useRef } from "react";

export function useProjectGraphStableActions(
  onToggleCollapse: (id: string) => void,
  onCreateNote: (position: { x: number; y: number }) => void,
  onEditNote: (id: string, text: string) => void,
  onDeleteNote: (id: string) => void,
) {
  // The ref is refreshed on every render, so a changed parent callback is always current while
  // the identity handed to the cards stays stable.
  const onToggleCollapseRef = useRef(onToggleCollapse);
  onToggleCollapseRef.current = onToggleCollapse;
  const toggleCollapse = useCallback((id: string) => {
    onToggleCollapseRef.current(id);
  }, []);
  // Same reasoning for the note actions: the note card holds its editor state, so a changed
  // function identity would rebuild its data and could interrupt a drag or an edit.
  const noteActions = useRef({ onCreateNote, onEditNote, onDeleteNote });
  noteActions.current = { onCreateNote, onEditNote, onDeleteNote };
  const createNote = useCallback((position: { x: number; y: number }) => {
    noteActions.current.onCreateNote(position);
  }, []);
  const editNote = useCallback((id: string, text: string) => {
    noteActions.current.onEditNote(id, text);
  }, []);
  const deleteNote = useCallback((id: string) => {
    noteActions.current.onDeleteNote(id);
  }, []);
  return { toggleCollapse, createNote, editNote, deleteNote };
}
