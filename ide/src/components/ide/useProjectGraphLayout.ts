// The project graph's saved-state lifecycle (D-126): load once per project, debounce writes,
// flush on unmount, reload when another writer changes the files, and the immutable actions
// the canvas/toolbar call.
//
// Extracted from ProjectGraphPanel so both files stay readable and under the 300-line limit:
// the panel keeps analysis/viewport/fullscreen, this hook keeps everything that ends up in
// `.facilis/graph`.
//
// The AI graph tools write the same files through graph-layout.ts and announce it on
// `graph-live`; the subscription below is why "organise my graph" shows up without a reload.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IdeController } from "@/vv/controller";
import {
  GRAPH_LAYOUT_SAVE_DELAY_MS,
  addGraphNote,
  emptyGraphLayout,
  loadGraphLayout,
  newNoteId,
  pruneGraphCurves,
  resetGraphLayoutPositions,
  saveGraphLayout,
  withCollapsed,
  withEdgeCurve,
  withHiddenEdgeKind,
  withNodePosition,
  withNotePosition,
  withNoteText,
  withViewport,
  withoutGraphNote,
  type GraphLayoutFile,
  type GraphPosition,
  type GraphViewport,
} from "@/facilis/graph-layout";
import { subscribeGraphLayoutChanged } from "@/facilis/graph-live";
import type { GraphCurve, GraphNote } from "@/facilis/graph-types";
import type { ProjectGraphSaveState } from "./ProjectGraphToolbar";

export interface ProjectGraphLayout {
  readonly layout: GraphLayoutFile;
  /** The saved notes, sorted by id so the canvas sees a stable list. */
  readonly notes: readonly GraphNote[];
  readonly layoutLoaded: boolean;
  readonly layoutInvalid: boolean;
  readonly saveState: ProjectGraphSaveState;
  readonly saveError: string | null;
  /** Increment a counter: the canvas turns it into "add a note at the viewport centre". */
  readonly addNoteNonce: number;
  readonly requestAddNote: () => void;
  readonly createNote: (position: GraphPosition) => void;
  readonly moveNode: (id: string, position: GraphPosition) => void;
  readonly moveNote: (id: string, position: GraphPosition) => void;
  readonly editNote: (id: string, text: string) => void;
  readonly deleteNote: (id: string) => void;
  readonly toggleCollapsed: (id: string) => void;
  readonly toggleEdgeKind: (kind: GraphLayoutFile["hiddenEdges"][number], hidden: boolean) => void;
  readonly changeViewport: (viewport: GraphViewport) => void;
  readonly changeEdgeCurve: (edgeId: string, curve: GraphCurve | null) => void;
  readonly resetPositions: () => void;
  readonly pruneCurves: (edgeIds: ReadonlySet<string>) => void;
  readonly saveNow: () => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useProjectGraphLayout(
  controller: IdeController,
  root: string | null,
): ProjectGraphLayout {
  const [layout, setLayout] = useState<GraphLayoutFile>(() => emptyGraphLayout());
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [layoutInvalid, setLayoutInvalid] = useState(false);
  const [saveState, setSaveState] = useState<ProjectGraphSaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addNoteNonce, setAddNoteNonce] = useState(0);
  const savedLayout = useRef<GraphLayoutFile | null>(null);
  const latestLayout = useRef(layout);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    latestLayout.current = layout;
  }, [layout]);

  const clearTimer = useCallback(() => {
    if (saveTimer.current === null) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }, []);

  // The saved state: read once per project. A corrupt settings file is a warning, not an error.
  useEffect(() => {
    let cancelled = false;
    savedLayout.current = null;
    setLayoutLoaded(false);
    setLayoutInvalid(false);
    if (root === null) {
      setLayout(emptyGraphLayout());
      return;
    }
    void loadGraphLayout(controller, root)
      .then((loaded) => {
        if (cancelled) return;
        setLayout(loaded.layout);
        setLayoutInvalid(loaded.source === "invalid");
        savedLayout.current = loaded.layout;
        setLayoutLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        const empty = emptyGraphLayout();
        setLayout(empty);
        setLayoutInvalid(true);
        savedLayout.current = empty;
        setLayoutLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [controller, root]);

  const runSave = useCallback(
    (next: GraphLayoutFile) => {
      if (root === null) return;
      setSaveState("saving");
      setSaveError(null);
      void saveGraphLayout(controller, root, next, savedLayout.current)
        .then(() => {
          savedLayout.current = next;
          setSaveState("saved");
        })
        .catch((error: unknown) => {
          setSaveState("error");
          setSaveError(errorText(error));
        });
    },
    [controller, root],
  );

  // Debounce: every drag/filter/collapse/note edit writes the files once it settles.
  useEffect(() => {
    if (root === null || !layoutLoaded) return;
    if (savedLayout.current === layout) return;
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      runSave(layout);
    }, GRAPH_LAYOUT_SAVE_DELAY_MS);
    return () => {
      clearTimer();
    };
  }, [layout, layoutLoaded, root, runSave, clearTimer]);

  // Leaving the tab must not drop the last drag: flush whatever is pending.
  useEffect(
    () => () => {
      if (root === null || savedLayout.current === latestLayout.current) return;
      void saveGraphLayout(controller, root, latestLayout.current).catch(() => {
        /* the tab is gone; the next open retries from the automatic layout */
      });
    },
    [controller, root],
  );

  // Another writer (the AI graph tools) changed the files: adopt the new state and cancel a
  // pending local write, so the reload cannot be overwritten by stale local data.
  useEffect(() => {
    if (root === null) return;
    return subscribeGraphLayoutChanged(() => {
      void loadGraphLayout(controller, root)
        .then((loaded) => {
          clearTimer();
          setLayout(loaded.layout);
          setLayoutInvalid(loaded.source === "invalid");
          savedLayout.current = loaded.layout;
        })
        .catch(() => {
          /* keep the current state: the next explicit action retries */
        });
    });
  }, [controller, root, clearTimer]);

  const notes = useMemo(() => {
    const ids = Object.keys(layout.notes).toSorted();
    return ids.flatMap((id) => {
      const note = layout.notes[id];
      return note === undefined ? [] : [note];
    });
  }, [layout.notes]);

  const createNote = useCallback((position: GraphPosition) => {
    const note: GraphNote = { id: newNoteId(), x: position.x, y: position.y, text: "" };
    setLayout((current) => addGraphNote(current, note));
  }, []);
  const requestAddNote = useCallback(() => setAddNoteNonce((value) => value + 1), []);
  const moveNode = useCallback(
    (id: string, position: GraphPosition) =>
      setLayout((current) => withNodePosition(current, id, position)),
    [],
  );
  const moveNote = useCallback(
    (id: string, position: GraphPosition) =>
      setLayout((current) => withNotePosition(current, id, position)),
    [],
  );
  const editNote = useCallback(
    (id: string, text: string) => setLayout((current) => withNoteText(current, id, text)),
    [],
  );
  const deleteNote = useCallback(
    (id: string) => setLayout((current) => withoutGraphNote(current, id)),
    [],
  );
  const toggleCollapsed = useCallback((id: string) => {
    setLayout((current) => withCollapsed(current, id, current.collapsed[id] !== true));
  }, []);
  const toggleEdgeKind = useCallback(
    (kind: GraphLayoutFile["hiddenEdges"][number], hidden: boolean) => {
      setLayout((current) => withHiddenEdgeKind(current, kind, hidden));
    },
    [],
  );
  const changeViewport = useCallback((viewport: GraphViewport) => {
    setLayout((current) => withViewport(current, viewport));
  }, []);
  const changeEdgeCurve = useCallback((edgeId: string, curve: GraphCurve | null) => {
    setLayout((current) => withEdgeCurve(current, edgeId, curve));
  }, []);
  const resetPositions = useCallback(() => {
    setLayout((current) => resetGraphLayoutPositions(current));
  }, []);
  const pruneCurves = useCallback((edgeIds: ReadonlySet<string>) => {
    setLayout((current) => pruneGraphCurves(current, edgeIds));
  }, []);
  const saveNow = useCallback(() => {
    clearTimer();
    runSave(latestLayout.current);
  }, [clearTimer, runSave]);

  return {
    layout,
    notes,
    layoutLoaded,
    layoutInvalid,
    saveState,
    saveError,
    addNoteNonce,
    requestAddNote,
    createNote,
    moveNode,
    moveNote,
    editNote,
    deleteNote,
    toggleCollapsed,
    toggleEdgeKind,
    changeViewport,
    changeEdgeCurve,
    resetPositions,
    pruneCurves,
    saveNow,
  };
}
