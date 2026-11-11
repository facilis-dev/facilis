// The AI-facing facade over the project graph's committed state (D-126).
//
// The graph is team state under `.facilis/graph`, not source code: arranging a node or writing
// a note changes no TypeScript, so the §9.3 validator and the user's proposal/Apply review have
// nothing to check. These tools therefore write the state files directly — read the layout,
// mutate it with the layout helpers, save it and tell the open panel to reload. Only source
// edits keep the patch-proposal flow.
//
// Node and edge ids come from the analyzer graph, geometry from the saved layout. A node without
// a saved position is reported at its deterministic automatic position (graph-model.ts), so the
// model may see coordinates it never wrote: it is reading the view, not a diff.
//
// `state()` is capped and reports analysis failures as data. `apply()` validates every field of
// an untrusted plan (the helpers live with the handlers in ptc/graph-tools.ts) before writing,
// and reports bad input as a PtcToolError that names the field, so a wrong call self-corrects.

import type { ProjectGraph } from "@facilis.dev/analyze";
import { loadProjectAnalysis } from "@/facilis/analyze-client";
import { buildProjectGraphView } from "@/facilis/graph-model";
import {
  GRAPH_EDGE_KINDS,
  addGraphNote,
  loadGraphLayout,
  newNoteId,
  saveGraphLayout,
  withCollapsed,
  withEdgeCurve,
  withHiddenEdgeKind,
  withNodePosition,
  withNotePosition,
  withNoteText,
  withoutGraphNote,
  type GraphLayoutFile,
  type GraphLayoutSource,
} from "@/facilis/graph-layout";
import { notifyGraphLayoutChanged } from "@/facilis/graph-live";
import type { IdeController } from "@/vv/controller";
import { validateGraphPlan, type GraphPlan } from "./ptc/graph-tools";
import { PtcToolError, type PtcJson } from "./ptc/protocol";

/** Caps keep one program's result readable: larger asks are guesses, not inspections. */
const MAX_STATE_NODES = 200;
const MAX_STATE_EDGES = 600;
const MAX_STATE_NOTES = 40;
const MAX_STATE_NOTE_CHARS = 2_000;

export interface GraphAccess {
  /** A project is open, so the graph state files are reachable. */
  available(): boolean;
  /** Compact graph facts; capped, and an analysis failure is returned as data. */
  state(): Promise<PtcJson>;
  /** Validate and apply arrangement changes; nothing is written when validation fails. */
  apply(plan: unknown): Promise<PtcJson>;
}

/** Changes a call applied; the keys are the plan fields it accepted. */
interface AppliedCounts {
  readonly [field: string]: number;
}

function unavailable(): PtcJson {
  return { available: false, reason: "no project is open: open a project, then retry" };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function applyPlan(
  input: GraphLayoutFile,
  plan: GraphPlan,
): { readonly layout: GraphLayoutFile; readonly applied: AppliedCounts } {
  let layout = input;
  for (const move of plan.moves)
    layout = withNodePosition(layout, move.id, { x: move.x, y: move.y });
  for (const curve of plan.curves) {
    layout = withEdgeCurve(layout, curve.edgeId, { x: curve.x, y: curve.y });
  }
  for (const id of plan.deleteNotes) layout = withoutGraphNote(layout, id);
  for (const note of plan.notes) {
    if (note.id === undefined) {
      layout = addGraphNote(layout, { id: newNoteId(), x: note.x, y: note.y, text: note.text });
    } else {
      layout = withNotePosition(layout, note.id, { x: note.x, y: note.y });
      layout = withNoteText(layout, note.id, note.text);
    }
  }
  // The plan carries the complete hidden set: a kind it omits is shown again.
  const hidden = new Set(plan.hiddenEdges);
  for (const kind of GRAPH_EDGE_KINDS) layout = withHiddenEdgeKind(layout, kind, hidden.has(kind));
  for (const entry of plan.collapsed) layout = withCollapsed(layout, entry.id, entry.collapsed);
  return {
    layout,
    applied: {
      moves: plan.moves.length,
      curves: plan.curves.length,
      created: plan.notes.filter((note) => note.id === undefined).length,
      edited: plan.notes.filter((note) => note.id !== undefined).length,
      deleted: plan.deleteNotes.length,
      hiddenEdges: plan.hiddenEdges.length,
      collapsed: plan.collapsed.length,
    },
  };
}

function stateJson(
  root: string,
  layout: GraphLayoutFile,
  source: GraphLayoutSource,
  graph: ProjectGraph,
): PtcJson {
  const view = buildProjectGraphView({
    graph,
    positions: layout.nodes,
    hiddenEdgeKinds: layout.hiddenEdges,
    collapsed: layout.collapsed,
  });
  const nodes: PtcJson[] = view.nodes
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      x: node.position.x,
      y: node.position.y,
    }));
  const edges: PtcJson[] = graph.edges
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map((edge) => {
      const curve = layout.edgeCurves[edge.id];
      const row: Record<string, PtcJson> = {
        id: edge.id,
        kind: edge.kind,
        source: edge.source,
        target: edge.target,
        label: edge.label,
      };
      if (curve !== undefined) row["curve"] = { x: curve.x, y: curve.y };
      return row;
    });
  const noteIds = Object.keys(layout.notes).toSorted();
  const notes: PtcJson[] = [];
  let notesTruncated = noteIds.length > MAX_STATE_NOTES;
  for (const id of noteIds.slice(0, MAX_STATE_NOTES)) {
    const note = layout.notes[id];
    if (note === undefined) continue;
    if (note.text.length > MAX_STATE_NOTE_CHARS) notesTruncated = true;
    notes.push({
      id: note.id,
      x: note.x,
      y: note.y,
      text: note.text.slice(0, MAX_STATE_NOTE_CHARS),
    });
  }
  return {
    available: true,
    root,
    source,
    counts: { nodes: graph.nodes.length, edges: graph.edges.length, notes: noteIds.length },
    nodes: nodes.slice(0, MAX_STATE_NODES),
    nodes_truncated: nodes.length > MAX_STATE_NODES,
    edges: edges.slice(0, MAX_STATE_EDGES),
    edges_truncated: edges.length > MAX_STATE_EDGES,
    notes,
    notes_truncated: notesTruncated,
    hidden_edges: [...layout.hiddenEdges],
    collapsed: Object.entries(layout.collapsed)
      .filter(([, value]) => value)
      .map(([id]) => id)
      .toSorted(),
  };
}

export function createGraphAccess(controller: IdeController): GraphAccess {
  const root = (): string | null => controller.activeFolder?.rootPath ?? null;

  const state = async (): Promise<PtcJson> => {
    const base = root();
    if (base === null) return unavailable();
    const [loaded, analysis] = await Promise.all([
      loadGraphLayout(controller, base),
      loadProjectAnalysis(controller),
    ]);
    if (!analysis.ok) {
      return { available: true, root: base, source: loaded.source, error: analysis.error };
    }
    return stateJson(base, loaded.layout, loaded.source, analysis.analysis.graph);
  };

  const apply = async (planInput: unknown): Promise<PtcJson> => {
    const base = root();
    if (base === null) return unavailable();
    const [loaded, analysis] = await Promise.all([
      loadGraphLayout(controller, base),
      loadProjectAnalysis(controller),
    ]);
    if (!analysis.ok) {
      throw new PtcToolError("exception", "cannot analyze the project: " + analysis.error);
    }
    const plan = validateGraphPlan(planInput, {
      nodes: new Set(analysis.analysis.graph.nodes.map((node) => node.id)),
      edges: new Set(analysis.analysis.graph.edges.map((edge) => edge.id)),
      notes: new Set(Object.keys(loaded.layout.notes)),
    });
    const { layout, applied } = applyPlan(loaded.layout, plan);
    try {
      await saveGraphLayout(controller, base, layout, loaded.layout);
    } catch (error) {
      throw new PtcToolError("exception", "cannot save the graph state: " + messageOf(error));
    }
    notifyGraphLayoutChanged();
    return { ok: true, applied };
  };

  return { available: () => root() !== null, state, apply };
}
