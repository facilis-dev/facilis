// A free-floating markdown annotation on the project-graph canvas (D-126). A note is a
// React Flow node with no handles — it never takes part in an edge — whose text is rendered
// with the notebook's markdown renderer, so it is escaped and contained by the same rules as
// a notebook cell (vv/notebook/render.js, NotebookView.tsx).
//
// Editing is local: the draft lives here and is committed only on blur or Ctrl/Cmd+Enter, so
// a click elsewhere cannot lose a half-typed note and Escape can restore the previous text.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { Node, NodeProps } from "@xyflow/react";
import Trash2 from "~icons/lucide/trash-2";
import { t } from "@/i18n";
import type { GraphNote } from "@/facilis/graph-types";
import { renderMarkdown } from "@/vv/notebook/render.js";

/** The React Flow node type for notes; the canvas registers it in PROJECT_GRAPH_NODE_TYPES. */
export const NOTE_NODE_TYPE = "note";

export type ProjectNoteFlowData = {
  readonly note: GraphNote;
  /** False when an AI focus request (D-171) names other nodes: the note is drawn dimmed. */
  readonly focused: boolean;
  readonly onEditNote: (id: string, text: string) => void;
  readonly onDeleteNote: (id: string) => void;
};

export type ProjectNoteFlowNode = Node<ProjectNoteFlowData, typeof NOTE_NODE_TYPE>;

const NOTE_BASE =
  "select-none rounded-md border bg-card px-2 py-1.5 text-card-foreground shadow-sm ";
const NOTE_MARKDOWN =
  "nowheel max-h-40 overflow-auto text-[11px] leading-snug [&_*]:my-0 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-0.5 [&_code]:font-mono [&_h1]:text-xs [&_h1]:font-semibold [&_h2]:text-[11px] [&_h2]:font-semibold [&_li]:ml-3 [&_ol]:list-decimal [&_strong]:font-semibold [&_ul]:list-disc";

export function ProjectGraphNoteNode({ data, selected, dragging }: NodeProps<ProjectNoteFlowNode>) {
  const { note, onEditNote, onDeleteNote } = data;
  // An empty note has nothing to read, so it opens straight in the editor: a note added from
  // the toolbar is immediately typeable instead of needing a second double-click.
  const [editing, setEditing] = useState(note.text.trim() === "");
  const [draft, setDraft] = useState(note.text);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // Escape cancels the edit and unmounts the textarea; the blur that can follow must not save
  // the discarded draft.
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) return;
    const element = textarea.current;
    if (element === null) return;
    element.focus();
    // Continue at the end of the existing text rather than selecting it away.
    element.setSelectionRange(element.value.length, element.value.length);
  }, [editing]);

  const startEditing = () => {
    cancelled.current = false;
    setDraft(note.text);
    setEditing(true);
  };
  const save = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    setEditing(false);
    if (draft !== note.text) onEditNote(note.id, draft);
  };
  const cancel = () => {
    cancelled.current = true;
    setDraft(note.text);
    setEditing(false);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      save();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // The panel listens for Escape on document to leave fullscreen: cancel the edit only.
      event.stopPropagation();
      cancel();
    }
  };

  const html = useMemo(() => renderMarkdown(note.text), [note.text]);
  const empty = note.text.trim() === "";

  return (
    <div
      data-testid="project-graph-note"
      title={t("projectGraph.noteHint")}
      className={
        NOTE_BASE +
        "w-64 " +
        (selected
          ? "border-primary ring-1 ring-primary"
          : dragging
            ? "border-primary shadow-lg ring-1 ring-ring"
            : "hover:border-ring") +
        // The focus dims an annotation like any other card: it names analysis nodes, not notes.
        (data.focused ? "" : " opacity-40")
      }
      onDoubleClick={(event) => {
        if (editing) return;
        event.stopPropagation();
        startEditing();
      }}
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              ref={textarea}
              value={draft}
              rows={3}
              placeholder={t("projectGraph.noteEmpty")}
              aria-label={t("projectGraph.noteHint")}
              className="nodrag nowheel block w-full resize-none select-text bg-transparent p-0 font-mono text-[11px] leading-snug text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={save}
              onKeyDown={onKeyDown}
            />
          ) : empty ? (
            <p className="text-[11px] italic text-muted-foreground">
              {t("projectGraph.noteEmpty")}
            </p>
          ) : (
            <div
              className={NOTE_MARKDOWN}
              // renderMarkdown escapes its input before applying any rule (see render.js and the
              // same pattern in NotebookView), so this string contains only markup this studio
              // generated; `contain` keeps that from being the only thing between a note and the
              // page if the renderer ever changes.
              style={{ contain: "layout paint" }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
        <button
          type="button"
          className="nodrag flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("projectGraph.noteDelete")}
          title={t("projectGraph.noteDelete")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onDeleteNote(note.id);
          }}
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
  );
}
