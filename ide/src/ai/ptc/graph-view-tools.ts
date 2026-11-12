// The graph view tool handlers (D-171): graph_highlight, graph_paths and graph_screenshot.
//
// The arguments arrive from a sandboxed program, so this module is the trust boundary: types,
// caps and required fields are checked here before graph-view-access.ts touches the graph. The
// access layer resolves ids against the VISIBLE view (unknown ids come back as data, not as an
// error), and the router adds the tool name and signature to every refusal.
//
// The ids are the canvas's ids: node ids from the analysis graph and edge ids from the analyzer
// edge list, filtered exactly like the panel filters them.

import { MAX_HOPS, MAX_PATHS } from "@/facilis/graph-paths";
import type { GraphViewAccess } from "../graph-view-access";
import { PtcToolError, type PtcJson } from "./protocol";

type Args = Record<string, unknown>;
/** A tool family handler: the router unwraps the arguments and formats refusals. */
export type GraphViewHandler = (args: Args) => Promise<PtcJson>;

const MAX_ID_CHARS = 300;
const MAX_NODE_IDS = 200;
const MAX_EDGE_IDS = 400;

function refuse(message: string): never {
  throw new PtcToolError("capability", message);
}

function optionalBoolean(args: Args, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") refuse(key + " must be a boolean");
  return value;
}

function optionalInteger(args: Args, key: string, min: number, max: number): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    refuse(key + " must be an integer between " + min + " and " + max);
  }
  return value;
}

function requiredString(args: Args, key: string, maxChars: number): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) {
    refuse(key + " must be a non-empty string of at most " + maxChars + " characters");
  }
  return value;
}

function optionalString(args: Args, key: string, maxChars: number): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) {
    refuse(key + " must be a non-empty string of at most " + maxChars + " characters");
  }
  return value;
}

/** A list of ids: absent is empty, and a duplicate is the same id, not a second focus target. */
function idList(args: Args, key: string, max: number): readonly string[] {
  const value = args[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) refuse(key + " must be an array of id strings");
  if (value.length > max) refuse(key + " accepts at most " + max + " ids");
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > MAX_ID_CHARS) {
      refuse(key + " must contain non-empty strings of at most " + MAX_ID_CHARS + " characters");
    }
    ids.push(entry);
  }
  return [...new Set(ids)];
}

export function createGraphViewHandlers(access: GraphViewAccess): Record<string, GraphViewHandler> {
  return {
    async graph_highlight(args) {
      // Absent arrays and booleans keep the documented defaults: clear the focus, fit the view.
      return access.highlight({
        nodes: idList(args, "nodes", MAX_NODE_IDS),
        edges: idList(args, "edges", MAX_EDGE_IDS),
        zoom: optionalBoolean(args, "zoom") ?? true,
      });
    },
    async graph_paths(args) {
      const from = requiredString(args, "from", MAX_ID_CHARS);
      const to = optionalString(args, "to", MAX_ID_CHARS);
      return access.paths({
        from,
        ...(to === undefined ? {} : { to }),
        maxPaths: optionalInteger(args, "maxPaths", 1, MAX_PATHS) ?? MAX_PATHS,
        maxHops: optionalInteger(args, "maxHops", 1, MAX_HOPS) ?? MAX_HOPS,
        highlight: optionalBoolean(args, "highlight") ?? true,
      });
    },
    async graph_screenshot(args) {
      const nodes = idList(args, "nodes", MAX_NODE_IDS);
      const edges = idList(args, "edges", MAX_EDGE_IDS);
      return access.capture({
        ...(nodes.length === 0 ? {} : { nodes }),
        ...(edges.length === 0 ? {} : { edges }),
      });
    },
  };
}
