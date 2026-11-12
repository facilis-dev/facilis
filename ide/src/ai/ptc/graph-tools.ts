// The graph tool handlers (D-126): what the model may read and rearrange on the project graph.
//
// The graph is committed team state under `.facilis/graph`, not source code, so graph-access.ts
// writes it directly instead of going through the patch proposal/Apply flow — that flow exists
// to review source changes with the §9.3 validator. This module is the trust boundary: the
// arguments arrive from a sandboxed program and are validated here before graph-access.ts
// touches the state files.
//
// "No project is open" is data (available: false), like the preview tools, so the model can ask
// the user and retry. The router adds the tool name and signature to every refusal.
//
// createRuntimeToolHandlers also lives here: the preview and graph families are the ones whose
// runtime seam may be absent, and that composition has to sit outside the 300-line router.

import type { GraphEdgeKind } from "@facilis.dev/analyze";
import { GRAPH_EDGE_KINDS } from "@/facilis/graph-layout";

import type { GraphAccess } from "../graph-access";
import type { PatchValidationHost } from "../patch-validation";
import { createGitHandlers } from "./git-tools";
import { createGraphViewHandlers } from "./graph-view-tools";
import { PtcToolError, type PtcJson } from "./protocol";
import { createPreviewHandlers } from "./preview-tools";

type Args = Record<string, unknown>;
/** A tool family handler: the router unwraps the arguments and formats refusals. */
export type RuntimeToolHandler = (args: Args) => Promise<PtcJson>;

const MAX_MOVES = 500;
const MAX_CURVES = 500;
const MAX_NOTES = 50;
const MAX_DELETES = 50;
const MAX_COLLAPSED = 500;
const MAX_NOTE_CHARS = 4_000;
const MAX_PLAN_ITEMS = 1_000;

const PLAN_FIELDS = ["moves", "curves", "notes", "delete_notes", "hidden_edges", "collapsed"];

export interface GraphPlanMove {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface GraphPlanCurve {
  readonly edgeId: string;
  readonly x: number;
  readonly y: number;
}

export interface GraphPlanNote {
  /** Absent means "create a note"; present must name an existing note. */
  readonly id?: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

export interface GraphPlanCollapse {
  readonly id: string;
  readonly collapsed: boolean;
}

export interface GraphPlan {
  readonly moves: readonly GraphPlanMove[];
  readonly curves: readonly GraphPlanCurve[];
  readonly notes: readonly GraphPlanNote[];
  readonly deleteNotes: readonly string[];
  readonly hiddenEdges: readonly GraphEdgeKind[];
  readonly collapsed: readonly GraphPlanCollapse[];
}

/** The ids the current analysis/layout report; anything else is stale or invented. */
export interface GraphPlanIds {
  readonly nodes: ReadonlySet<string>;
  readonly edges: ReadonlySet<string>;
  readonly notes: ReadonlySet<string>;
}

function fail(message: string): never {
  throw new PtcToolError("capability", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordOf(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) fail(what + " must be a JSON object");
  return value;
}

function listOf(value: unknown, what: string, max: number): readonly unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(what + " must be an array");
  if (value.length > max) fail(what + " accepts at most " + max + " entries");
  return value;
}

function positionOf(value: Record<string, unknown>, what: string): { x: number; y: number } {
  const { x, y } = value;
  if (typeof x !== "number" || !Number.isFinite(x)) fail(what + ".x must be a finite number");
  if (typeof y !== "number" || !Number.isFinite(y)) fail(what + ".y must be a finite number");
  return { x, y };
}

function knownIdOf(value: unknown, known: ReadonlySet<string>, what: string): string {
  if (typeof value !== "string") fail(what + " must be a string id");
  if (!known.has(value)) fail(what + " is not in the current graph: " + JSON.stringify(value));
  return value;
}

function noteTextOf(value: unknown, what: string): string {
  if (typeof value !== "string") fail(what + " must be a string");
  if (value.length > MAX_NOTE_CHARS) {
    fail(what + " must be at most " + MAX_NOTE_CHARS + " characters");
  }
  return value;
}

/** Validate an untrusted graph_arrange argument object into a typed plan. */
export function validateGraphPlan(input: unknown, ids: GraphPlanIds): GraphPlan {
  const plan = recordOf(input, "graph_arrange arguments");
  for (const key of Object.keys(plan)) {
    if (!PLAN_FIELDS.includes(key)) {
      fail(
        "unknown field " +
          JSON.stringify(key) +
          "; graph_arrange accepts " +
          PLAN_FIELDS.join(", "),
      );
    }
  }
  const moves = listOf(plan["moves"], "moves", MAX_MOVES).map((entry, index): GraphPlanMove => {
    const move = recordOf(entry, "moves[" + index + "]");
    const position = positionOf(move, "moves[" + index + "]");
    return {
      id: knownIdOf(move["id"], ids.nodes, "moves[" + index + "].id"),
      x: position.x,
      y: position.y,
    };
  });
  const curves = listOf(plan["curves"], "curves", MAX_CURVES).map(
    (entry, index): GraphPlanCurve => {
      const curve = recordOf(entry, "curves[" + index + "]");
      const position = positionOf(curve, "curves[" + index + "]");
      return {
        edgeId: knownIdOf(curve["edgeId"], ids.edges, "curves[" + index + "].edgeId"),
        x: position.x,
        y: position.y,
      };
    },
  );
  const notes = listOf(plan["notes"], "notes", MAX_NOTES).map((entry, index): GraphPlanNote => {
    const note = recordOf(entry, "notes[" + index + "]");
    const position = positionOf(note, "notes[" + index + "]");
    const text = noteTextOf(note["text"], "notes[" + index + "].text");
    const id =
      note["id"] === undefined
        ? undefined
        : knownIdOf(note["id"], ids.notes, "notes[" + index + "].id");
    if (id === undefined) return { x: position.x, y: position.y, text };
    return { id, x: position.x, y: position.y, text };
  });
  const deleteNotes = listOf(plan["delete_notes"], "delete_notes", MAX_DELETES).map(
    (entry, index) => knownIdOf(entry, ids.notes, "delete_notes[" + index + "]"),
  );
  const hiddenEdges = listOf(plan["hidden_edges"], "hidden_edges", GRAPH_EDGE_KINDS.length).map(
    (entry, index): GraphEdgeKind => {
      if (typeof entry !== "string" || !GRAPH_EDGE_KINDS.includes(entry as GraphEdgeKind)) {
        fail("hidden_edges[" + index + "] must be one of " + GRAPH_EDGE_KINDS.join(", "));
      }
      return entry as GraphEdgeKind;
    },
  );
  const collapsed = listOf(plan["collapsed"], "collapsed", MAX_COLLAPSED).map(
    (entry, index): GraphPlanCollapse => {
      const change = recordOf(entry, "collapsed[" + index + "]");
      if (typeof change["collapsed"] !== "boolean") {
        fail("collapsed[" + index + "].collapsed must be a boolean");
      }
      return {
        id: knownIdOf(change["id"], ids.nodes, "collapsed[" + index + "].id"),
        collapsed: change["collapsed"],
      };
    },
  );
  for (const note of notes) {
    if (note.id !== undefined && deleteNotes.includes(note.id)) {
      fail("notes must not both edit and delete " + JSON.stringify(note.id));
    }
  }
  const items =
    moves.length +
    curves.length +
    notes.length +
    deleteNotes.length +
    hiddenEdges.length +
    collapsed.length;
  if (items > MAX_PLAN_ITEMS) {
    fail(
      "the plan has " + items + " changes; at most " + MAX_PLAN_ITEMS + " are accepted per call",
    );
  }
  return { moves, curves, notes, deleteNotes, hiddenEdges, collapsed };
}

function unavailable(): PtcJson {
  return { available: false, reason: "no project is open: open a project, then retry" };
}

export function createGraphHandlers(access: GraphAccess): Record<string, RuntimeToolHandler> {
  return {
    async graph_state() {
      return access.available() ? access.state() : unavailable();
    },
    async graph_arrange(args) {
      if (!access.available()) return unavailable();
      return access.apply(args);
    },
  };
}

/**
 * Every tool family that exists only with its runtime seam. Built here because graph-tools is
 * the newest such family and the router must stay under the 300-line source limit.
 */
export function createRuntimeToolHandlers(
  host: PatchValidationHost,
): Readonly<Record<string, RuntimeToolHandler>> {
  return {
    ...(host.preview === undefined ? {} : createPreviewHandlers(host.preview)),
    ...(host.graph === undefined ? {} : createGraphHandlers(host.graph)),
    ...(host.graphView === undefined ? {} : createGraphViewHandlers(host.graphView)),
    ...(host.git === undefined ? {} : createGitHandlers(host.git)),
  };
}
