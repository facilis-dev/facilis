// One graph note as a DOM card on the map-and-lens surface (issue #194). The canvas draws the
// graph; notes stay DOM so markdown, a textarea and the delete control keep their native
// semantics. Position and visibility are written by the overlay hook, never by React per frame.
//
// Editing is local: the draft lives here and is committed on blur or Ctrl/Cmd+Enter, so Escape
// can restore the previous text; an empty committed note is deleted instead of persisted.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import GripVertical from "~icons/lucide/grip-vertical";
import Trash2 from "~icons/lucide/trash-2";
import { t } from "@/i18n";
import type { GraphPosition } from "@/facilis/graph-layout";
import { roundCoordinate } from "@/facilis/graph-layout-file";
import type { SurfaceCamera } from "@/facilis/graph-surface/camera.ts";
import { isNoteEmpty, NOTE_WIDTH, noteTitle } from "@/facilis/graph-surface/notes.ts";
import type { GraphNote } from "@/facilis/graph-types";
import { renderMarkdown } from "@/vv/notebook/render.js";

const NOTE_CARD =
  "pointer-events-auto absolute left-0 top-0 origin-top-left select-none rounded-md border bg-card text-card-foreground shadow-sm ";
const NOTE_BODY =
  "max-h-40 overflow-auto px-2 py-1.5 text-[11px] leading-snug [&_*]:my-0 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-0.5 [&_code]:font-mono [&_h1]:text-xs [&_h1]:font-semibold [&_h2]:text-[11px] [&_h2]:font-semibold [&_li]:ml-3 [&_ol]:list-decimal [&_strong]:font-semibold [&_ul]:list-disc";

type EditStatus = "idle" | "committed" | "cancelled";

interface NoteDrag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly x: number;
  readonly y: number;
}

export function ProjectGraphNoteCard({
  note,
  editing,
  selected,
  cameraRef,
  registerRef,
  onStartEdit,
  onCommitEdit,
  onCloseEditor,
  onDelete,
  onMove,
}: {
  note: GraphNote;
  editing: boolean;
  selected: boolean;
  cameraRef: RefObject<SurfaceCamera>;
  registerRef: (element: HTMLDivElement | null) => void;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, text: string) => void;
  onCloseEditor: () => void;
  onDelete: (id: string) => void;
  onMove: (id: string, position: GraphPosition) => void;
}) {
  const [draft, setDraft] = useState(note.text);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const status = useRef<EditStatus>("idle");
  const drag = useRef<NoteDrag | null>(null);
  const html = useMemo(() => renderMarkdown(note.text), [note.text]);
  const title = noteTitle(note.text) || t("projectGraph.noteEmpty");

  useEffect(() => {
    if (!editing) return;
    status.current = "idle";
    setDraft(note.text);
    const element = textarea.current;
    if (element === null) return;
    element.focus();
    // Continue at the end of the existing text rather than selecting it away.
    element.setSelectionRange(element.value.length, element.value.length);
  }, [editing, note.id, note.text]);

  const startEditing = () => {
    if (editing) return;
    setDraft(note.text);
    onStartEdit(note.id);
  };

  const commit = () => {
    if (status.current !== "idle") return;
    status.current = "committed";
    if (isNoteEmpty(draft)) onDelete(note.id);
    else if (draft !== note.text) onCommitEdit(note.id, draft);
    onCloseEditor();
  };

  const cancel = () => {
    if (status.current !== "idle") return;
    status.current = "cancelled";
    setDraft(note.text);
    onCloseEditor();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      commit();
      return;
    }
    if (event.key === "Escape") {
      // The panel listens for Escape on document to leave fullscreen/the drawer: cancel the edit
      // only, never fall through to the rest of the ladder.
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: note.x,
      y: note.y,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    const scale = cameraRef.current.scale;
    if (!(scale > 0)) return;
    onMove(note.id, {
      x: roundCoordinate(state.x + (event.clientX - state.startX) / scale),
      y: roundCoordinate(state.y + (event.clientY - state.startY) / scale),
    });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={registerRef}
      data-testid="project-graph-note-card"
      data-note-id={note.id}
      title={t("projectGraph.noteHint")}
      className={
        NOTE_CARD + (selected ? "border-primary ring-1 ring-primary" : "hover:border-ring")
      }
      style={{ width: NOTE_WIDTH, visibility: "hidden" }}
    >
      <div
        className="flex cursor-grab touch-none items-center gap-1 border-b px-1.5 py-1 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <GripVertical className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium">{title}</span>
        <button
          type="button"
          data-testid="project-graph-note-delete"
          className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("projectGraph.noteDelete")}
          title={t("projectGraph.noteDelete")}
          onPointerDown={(event) => {
            event.stopPropagation();
            // Keep the editor's focus: deleting must not first commit a half-typed draft.
            event.preventDefault();
          }}
          onClick={(event) => {
            event.stopPropagation();
            status.current = "committed";
            onDelete(note.id);
            onCloseEditor();
          }}
        >
          <Trash2 className="size-3" />
        </button>
      </div>
      {editing ? (
        <textarea
          ref={textarea}
          value={draft}
          rows={4}
          placeholder={t("projectGraph.noteEmpty")}
          aria-label={t("projectGraph.noteHint")}
          className="block w-full resize-none bg-transparent px-2 py-1.5 font-mono text-[11px] leading-snug text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      ) : isNoteEmpty(note.text) ? (
        <button
          type="button"
          className="block w-full px-2 py-1.5 text-left text-[11px] italic text-muted-foreground"
          onClick={startEditing}
        >
          {t("projectGraph.noteEmpty")}
        </button>
      ) : (
        <div
          className={NOTE_BODY}
          // renderMarkdown escapes its input before applying any rule (vv/notebook/render.js),
          // so this string contains only markup this studio generated; contain keeps that from
          // being the only thing between a note and the page if the renderer ever changes.
          style={{ contain: "layout paint" }}
          onClick={startEditing}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
