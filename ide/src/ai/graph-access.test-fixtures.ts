// Shared fixtures for the AI graph-access tests: the fake VFS controller, the seeded layout
// files and the analysis/graph builders. Split out so the test module stays under the 300-line
// source limit; not a test module itself (the file name does not match Vitest's test glob).
import type { Analysis, ProjectGraph } from "@facilis/analyze";
import type { IdeController } from "@/vv/controller";
import { GRAPH_LAYOUT_PATH, GRAPH_NOTES_DIR } from "@/facilis/graph-layout-file";
import { elementPath } from "@/facilis/graph-layout-files";
import { graphOf, GET, PAGE, TODOS } from "@/facilis/graph-model.test-fixtures";
import { analyzeSources } from "./analysis-fixtures";
import type { GraphAccess } from "./graph-access";
import { isPtcToolError } from "./ptc/protocol";

export const ROOT = "/w/app";
export const NOTE = "note:11111111-1111-4111-8111-111111111111";
export const OLD_NOTE = "note:22222222-2222-4222-8222-222222222222";
const empty = analyzeSources(new Map());
export const analysisOf = (graph: ProjectGraph): Analysis => ({ ...empty, graph });

export const GRAPH = graphOf(
  [PAGE, GET, TODOS],
  [
    { id: "page-route:1", kind: "page-route", source: PAGE.id, target: GET.id, label: null },
    { id: "route-table:1", kind: "route-table", source: GET.id, target: TODOS.id, label: null },
  ],
);

export function uuidOf(index: number): string {
  return String(index).padStart(8, "0") + "-0000-4000-8000-000000000000";
}

export function fakeController(files: Record<string, string>, root: string | null = ROOT) {
  const writes: { type: string; path: string; contents?: string }[] = [];
  const removed: string[] = [];
  const children = (dir: string): { name: string; dir: boolean }[] => {
    const prefix = dir + "/";
    const names = new Map<string, boolean>();
    for (const path of Object.keys(files)) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (name !== "") names.set(name, (names.get(name) ?? false) || slash !== -1);
    }
    return [...names].map(([name, nested]) => ({ name, dir: nested }));
  };
  return {
    controller: {
      activeFolder: root === null ? null : { rootPath: root },
      readFileText: async (path: string) => files[path] ?? "",
      readdir: async (dir: string) => children(dir),
      pathInfo: async (path: string) => ({
        exists: path in files || Object.keys(files).some((entry) => entry.startsWith(path + "/")),
        isDir: false,
      }),
      bridge: {
        request: async (type: string, extra?: Record<string, unknown>) => {
          const path = String(extra?.path ?? "");
          const contents = typeof extra?.contents === "string" ? extra.contents : undefined;
          writes.push({ type, path, contents });
          if (type === "vv-write") files[path] = contents ?? "";
          if (type === "vv-rm") {
            delete files[path];
            removed.push(path);
          }
          return { type: "vv-reply", ok: true };
        },
      },
    } as unknown as IdeController,
    files,
    writes,
    removed,
  };
}

/** Seed the v3 layout files: settings plus node positions and note bodies. */
export function seedLayout(
  layout: Record<string, unknown>,
  positions: readonly string[] = [],
  notes: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const files: Record<string, string> = {
    [ROOT + "/" + GRAPH_LAYOUT_PATH]: JSON.stringify({ version: 3, ...layout }),
  };
  // One position file per element (D-126), keyed exactly like the real encoder.
  for (const line of positions) {
    const entry = JSON.parse(line) as { id: string };
    files[ROOT + "/" + elementPath(entry.id)] = line + "\n";
  }
  for (const [id, text] of Object.entries(notes)) {
    files[ROOT + "/" + GRAPH_NOTES_DIR + "/" + id.slice(5) + ".md"] = text;
  }
  return files;
}

export interface StateView {
  available: boolean;
  root?: string;
  source?: string;
  error?: string;
  counts?: { nodes: number; edges: number; notes: number };
  nodes?: { id: string; kind: string; label: string; x: number; y: number }[];
  nodes_truncated?: boolean;
  edges?: { id: string; kind: string; curve?: { x: number; y: number } }[];
  edges_truncated?: boolean;
  notes?: { id: string; x: number; y: number; text: string }[];
  notes_truncated?: boolean;
  hidden_edges?: string[];
  collapsed?: string[];
}

export async function stateOf(access: GraphAccess): Promise<StateView> {
  return (await access.state()) as unknown as StateView;
}

export async function refusalOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (isPtcToolError(error)) return error;
    throw error;
  }
  throw new Error("expected the call to be refused");
}
