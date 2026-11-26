// The notes DOM overlay on the map-and-lens surface (issue #194). One card per saved note; the
// surface's draw loop tells useGraphSurfaceNotes where each card goes, so this component only
// re-renders when the note set, selection or editor changes — never on pan/zoom.

import type { RefObject } from "react";
import type { GraphPosition } from "@/facilis/graph-layout";
import type { SurfaceCamera } from "@/facilis/graph-surface/camera.ts";
import type { GraphNote } from "@/facilis/graph-types";
import { ProjectGraphNoteCard } from "./ProjectGraphNoteCard";

export function ProjectGraphNotesLayer({
  notes,
  registerNote,
  cameraRef,
  editingNoteId,
  selectedNoteId,
  onStartEdit,
  onCommitEdit,
  onCloseEditor,
  onDeleteNote,
  onMoveNote,
}: {
  notes: readonly GraphNote[];
  registerNote: (id: string, element: HTMLDivElement | null) => void;
  cameraRef: RefObject<SurfaceCamera>;
  editingNoteId: string | null;
  selectedNoteId: string | null;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, text: string) => void;
  onCloseEditor: () => void;
  onDeleteNote: (id: string) => void;
  onMoveNote: (id: string, position: GraphPosition) => void;
}) {
  if (notes.length === 0) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0"
      data-testid="project-graph-notes-layer"
    >
      {notes.map((note) => (
        <ProjectGraphNoteCard
          key={note.id}
          note={note}
          editing={editingNoteId === note.id}
          selected={selectedNoteId === note.id}
          cameraRef={cameraRef}
          registerRef={(element) => registerNote(note.id, element)}
          onStartEdit={onStartEdit}
          onCommitEdit={onCommitEdit}
          onCloseEditor={onCloseEditor}
          onDelete={onDeleteNote}
          onMove={onMoveNote}
        />
      ))}
    </div>
  );
}
