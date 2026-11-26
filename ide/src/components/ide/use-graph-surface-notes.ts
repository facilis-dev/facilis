// The notes overlay's positioning (issue #194): the surface calls position() from the dirty-only
// draw loop, so pan/zoom keeps every visible card glued to its world point without a React render
// per frame. The layer only re-renders when the note set or the editor changes; visibility and
// transform are written straight onto the card elements, never into canvas/layout/camera state.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { SurfaceCamera } from "@/facilis/graph-surface/camera.ts";
import type { SurfaceRect } from "@/facilis/graph-surface/layout.ts";
import {
  noteContentCentre,
  noteInContentBox,
  noteScreenPlacement,
  noteWorldRect,
} from "@/facilis/graph-surface/notes.ts";
import type { SurfaceInsets } from "@/facilis/graph-surface/safe-area.ts";
import type { GraphPosition } from "@/facilis/graph-layout";
import type { GraphNote } from "@/facilis/graph-types";
import type { SurfaceSize } from "./use-graph-surface-camera";

export interface GraphSurfaceNotes {
  readonly registerNote: (id: string, element: HTMLDivElement | null) => void;
  readonly positionNotes: () => void;
  readonly selectedNoteId: string | null;
  readonly focusNote: (id: string) => void;
  readonly startEditingNote: (id: string) => void;
}

export function useGraphSurfaceNotes({
  notes,
  addNoteNonce,
  createNote,
  startNoteEdit,
  cameraRef,
  sizeRef,
  getInsets,
  centerOn,
}: {
  notes: readonly GraphNote[];
  addNoteNonce: number;
  createNote: (position: GraphPosition) => string;
  startNoteEdit: (id: string | null) => void;
  cameraRef: RefObject<SurfaceCamera>;
  sizeRef: RefObject<SurfaceSize>;
  /** Read live: the HUD/drawer insets change with the mode and the sheet, not per frame. */
  getInsets: () => SurfaceInsets;
  centerOn: (rect: SurfaceRect) => void;
}): GraphSurfaceNotes {
  const notesRef = useRef(notes);
  notesRef.current = notes;
  // Latest-ref pattern: positionNotes stays stable, so the draw-loop effect that calls it is not
  // torn down and re-run (with a re-fit) every time the drawer/sheet insets change.
  const getInsetsRef = useRef(getInsets);
  getInsetsRef.current = getInsets;
  const cards = useRef(new Map<string, HTMLDivElement>());
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  const registerNote = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element === null) cards.current.delete(id);
    else cards.current.set(id, element);
  }, []);

  const positionNotes = useCallback(() => {
    const insets = getInsetsRef.current();
    const size = sizeRef.current;
    const camera = cameraRef.current;
    for (const note of notesRef.current) {
      const element = cards.current.get(note.id);
      if (element === undefined) continue;
      if (!noteInContentBox(note, camera, size, insets)) {
        element.style.visibility = "hidden";
        continue;
      }
      element.style.visibility = "visible";
      element.style.transform = noteScreenPlacement(note, camera).transform;
    }
  }, [cameraRef, sizeRef]);

  // A newly mounted card has no transform yet: place the set once after render, then let the
  // draw loop keep it in sync with pan/zoom.
  useLayoutEffect(() => {
    positionNotes();
  }, [notes, positionNotes]);

  // The toolbar asks for a note through a nonce: create it where the user can see it and open
  // the editor immediately.
  const handledAddNote = useRef(addNoteNonce);
  useEffect(() => {
    if (addNoteNonce === handledAddNote.current) return;
    handledAddNote.current = addNoteNonce;
    const id = createNote(noteContentCentre(cameraRef.current, sizeRef.current, getInsets()));
    setSelectedNoteId(id);
    startNoteEdit(id);
  }, [addNoteNonce, createNote, startNoteEdit, cameraRef, sizeRef, getInsets]);

  // The sr-only list brings a note into view by centring the free content box on it (#194).
  const focusNote = useCallback(
    (id: string) => {
      const note = notes.find((entry) => entry.id === id);
      if (note === undefined) return;
      setSelectedNoteId(id);
      centerOn(noteWorldRect(note));
    },
    [notes, centerOn],
  );

  const startEditingNote = useCallback(
    (id: string) => {
      setSelectedNoteId(id);
      startNoteEdit(id);
    },
    [startNoteEdit],
  );

  return { registerNote, positionNotes, selectedNoteId, focusNote, startEditingNote };
}
