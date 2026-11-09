// The filesystem half of the project-graph state (D-126): read the per-element files under
// `.facilis/graph` and write only what changed. graph-layout-files.ts owns the encoding, this
// module owns the kernel VFS calls, and graph-layout.ts re-exports both as one import path.
//
// Saving is a diff against the previously written layout, so a drag writes one small position
// file and nothing else. The allowlist in `.facilis/.gitignore` is what makes the graph
// committable while the rest of `.facilis` (D-052) stays local; it is extended, never rewritten.

import type { IdeController } from "@/vv/controller";
import {
  GRAPH_BENDS_DIR,
  GRAPH_DIR,
  GRAPH_LAYOUT_PATH,
  GRAPH_LEGACY_PATH,
  GRAPH_NOTES_DIR,
  GRAPH_POSITIONS_DIR,
  GRAPH_VIEWPORT_PATH,
  type GraphLayoutFile,
  type GraphLayoutSource,
} from "./graph-layout-file";
import { decodeGraphLayout, encodeGraphLayout, noteIdFromFileName } from "./graph-layout-files";

export type GraphLayoutLoad = {
  readonly layout: GraphLayoutFile;
  readonly source: GraphLayoutSource;
};

/** Files written by the pre-element layouts; removed after the first v3 save. */
const OBSOLETE_FILES = [
  ".facilis/graph/nodes.jsonl",
  ".facilis/graph/edges.jsonl",
  ".facilis/graph.json",
];

async function readText(controller: IdeController, path: string): Promise<string> {
  return await controller.readFileText(path);
}

async function writeText(controller: IdeController, path: string, contents: string): Promise<void> {
  const reply = await controller.bridge.request("vv-write", { path, contents });
  if (reply.ok !== true) {
    throw new Error(typeof reply.error === "string" ? reply.error : "vv-write failed");
  }
}

async function removePath(controller: IdeController, path: string): Promise<void> {
  await controller.bridge.request("vv-rm", { path });
}

async function pathExists(controller: IdeController, path: string): Promise<boolean> {
  const info = await controller.pathInfo(path);
  return info.exists;
}

/** Every regular file in one directory: name → text. A missing directory is empty. */
async function readDirFiles(
  controller: IdeController,
  dir: string,
): Promise<Record<string, string>> {
  const entries = (await controller.readdir(dir)).filter((entry) => !entry.dir);
  const files: Record<string, string> = {};
  await Promise.all(
    entries.map(async (entry) => {
      files[entry.name] = await controller.readFileText(dir + "/" + entry.name);
    }),
  );
  return files;
}

/** The markdown bodies of every note file: `note:<uuid>` → text (an empty note is valid). */
async function readNoteBodies(
  controller: IdeController,
  dir: string,
): Promise<Record<string, string>> {
  const bodies: Record<string, string> = {};
  for (const [name, text] of Object.entries(await readDirFiles(controller, dir))) {
    const id = noteIdFromFileName(name);
    if (id !== null) bodies[id] = text;
  }
  return bodies;
}

/** Read the project's saved state. A missing or unreadable state is not an error. */
export async function loadGraphLayout(
  controller: IdeController,
  root: string,
): Promise<GraphLayoutLoad> {
  const [layout, viewport] = await Promise.all([
    readText(controller, root + "/" + GRAPH_LAYOUT_PATH),
    readText(controller, root + "/" + GRAPH_VIEWPORT_PATH),
  ]);
  const [positions, bends, notes] = await Promise.all([
    readDirFiles(controller, root + "/" + GRAPH_POSITIONS_DIR),
    readDirFiles(controller, root + "/" + GRAPH_BENDS_DIR),
    readNoteBodies(controller, root + "/" + GRAPH_NOTES_DIR),
  ]);
  const hasV3 =
    layout.trim() !== "" ||
    viewport.trim() !== "" ||
    [positions, bends, notes].some((files) => Object.keys(files).length > 0);
  // Only pay for the legacy read when the v3 files are absent: a migrated project must not
  // resurrect positions from the old file.
  const legacy = hasV3 ? null : await readText(controller, root + "/" + GRAPH_LEGACY_PATH);
  const parsed = decodeGraphLayout({ layout, viewport, positions, bends, notes, legacy });
  return { layout: parsed.layout, source: parsed.source };
}

const GITIGNORE_RULES = [
  "# Facilis dev state (D-052). The project graph is team state: commit it (D-126).",
  "*",
  "!graph/",
  "!graph/**",
  "graph/viewport.json",
].join("\n");

/**
 * `.facilis/.gitignore` starts as `*` (every dev artefact is local). Append the graph
 * allowlist — never rewrite the file, and never append twice — so the graph is visible to git.
 * The rules are relative to `.facilis`, hence `!graph/` rather than `.facilis/graph`.
 */
async function ensureGraphTracked(controller: IdeController, root: string): Promise<void> {
  const path = root + "/.facilis/.gitignore";
  const current = await readText(controller, path);
  if (current.includes("!graph/")) return;
  const next =
    current.trim() === ""
      ? GITIGNORE_RULES + "\n"
      : current.replace(/\s*$/u, "\n") + "\n" + GITIGNORE_RULES + "\n";
  await writeText(controller, path, next);
}

async function dropObsoleteFiles(controller: IdeController, root: string): Promise<void> {
  const present = await Promise.all(
    OBSOLETE_FILES.map(async (path) =>
      (await pathExists(controller, root + "/" + path)) ? root + "/" + path : null,
    ),
  );
  await Promise.all(
    present.flatMap((path) => (path === null ? [] : [removePath(controller, path)])),
  );
}

/**
 * Write the state through the kernel VFS. `previous` is the layout the caller last read or
 * wrote: providing it turns the save into a diff (one file per moved element) and lets files
 * whose element disappeared be removed. Without it every file is (re)written.
 */
export async function saveGraphLayout(
  controller: IdeController,
  root: string,
  layout: GraphLayoutFile,
  previous?: GraphLayoutFile | null,
): Promise<void> {
  await Promise.all([
    controller.bridge.request("vv-mkdirp", { path: root + "/" + GRAPH_DIR }),
    controller.bridge.request("vv-mkdirp", { path: root + "/" + GRAPH_POSITIONS_DIR }),
    controller.bridge.request("vv-mkdirp", { path: root + "/" + GRAPH_BENDS_DIR }),
    controller.bridge.request("vv-mkdirp", { path: root + "/" + GRAPH_NOTES_DIR }),
  ]);
  await ensureGraphTracked(controller, root);
  const writes = encodeGraphLayout(layout);
  const before =
    previous === undefined || previous === null
      ? null
      : new Map(encodeGraphLayout(previous).map((write) => [write.path, write.contents]));
  const changed =
    before === null ? writes : writes.filter((write) => before.get(write.path) !== write.contents);
  await Promise.all(
    changed.map((write) => writeText(controller, root + "/" + write.path, write.contents)),
  );
  if (before !== null) {
    const wanted = new Set(writes.map((write) => write.path));
    const removed = [...before.keys()].filter((path) => !wanted.has(path));
    await Promise.all(removed.map((path) => removePath(controller, root + "/" + path)));
  }
  await dropObsoleteFiles(controller, root);
}
