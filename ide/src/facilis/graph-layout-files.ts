// Encoding/decoding of the project-graph state files (D-126). The file layout *is* the merge
// strategy: one small file per element, so a normal git 3-way merge is automatic even when two
// branches touch adjacent nodes.
//
//   .facilis/graph/layout.json           view settings (pretty JSON)
//   .facilis/graph/positions/<key>.json  one {"id","x","y"} per analysis node or note
//   .facilis/graph/bends/<key>.json      one manual bend per edge
//   .facilis/graph/notes/<uuid>.md       one markdown file per annotation
//   .facilis/graph/viewport.json         pan/zoom (git-ignored: per machine)
//
// A per-element directory was chosen over one JSONL after checking git: two JSONL lines that are
// adjacent are a merge conflict even when they are different nodes, while two different files
// never conflict. The <key> is the element id, percent-encoded (with a short hash fallback for
// long ids); it exists only so a human can find a file, because the decoder reads the id from the
// content.
//
// Pure: no VFS access, so the tests drive the codec directly.

import type { GraphEdgeKind } from "@facilis.dev/analyze";
import {
  GRAPH_BENDS_DIR,
  GRAPH_LAYOUT_PATH,
  GRAPH_LAYOUT_VERSION,
  GRAPH_NOTES_DIR,
  GRAPH_NOTE_PREFIX,
  GRAPH_POSITIONS_DIR,
  GRAPH_VIEWPORT_PATH,
  emptyGraphLayout,
  isFiniteNumber,
  isNoteId,
  isNoteUuid,
  isRecord,
  parseGraphLayout,
  readCollapsed,
  readEdgeKinds,
  readViewport,
  roundCoordinate,
  sortedEntries,
  type GraphLayoutFile,
  type GraphPosition,
  type ParsedGraphLayout,
} from "./graph-layout-file";
import { GRAPH_EDGE_KINDS, type GraphCurve, type GraphNote } from "./graph-types";

/** The raw text of each state file; `null`/`undefined`/`""` all mean "absent". */
export interface GraphLayoutFiles {
  readonly layout?: string | null;
  readonly viewport?: string | null;
  /** Positions directory: file name → text. */
  readonly positions?: Readonly<Record<string, string>>;
  /** Bends directory: file name → text. */
  readonly bends?: Readonly<Record<string, string>>;
  /** Notes directory: note id → markdown. */
  readonly notes?: Readonly<Record<string, string>>;
  /** The pre-D-126 single file, read only while `.facilis/graph/` does not exist yet. */
  readonly legacy?: string | null;
}

export interface GraphLayoutWrite {
  /** Project-relative path. */
  readonly path: string;
  readonly contents: string;
}

/** Where a hand-edited note without a saved position is parked: deterministic, not random. */
const NOTE_FALLBACK: GraphPosition = { x: 40, y: 40 };
/** Longest readable element file name before falling back to a hash. */
const MAX_NAME_CHARS = 180;

function blankToNull(text: string | null | undefined): string | null {
  if (text === null || text === undefined || text.trim() === "") return null;
  return text;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readPositioned(value: unknown): { id: string; position: GraphPosition } | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  return { id: value.id, position: { x: value.x, y: value.y } };
}

/** FNV-1a: only for the rare id whose readable name would exceed the file-name limit. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The file name for one element id: readable, filesystem-safe, stable. */
export function elementFileName(id: string): string {
  const readable = encodeURIComponent(id);
  if (readable.length <= MAX_NAME_CHARS) return readable + ".json";
  return "~" + shortHash(id) + "-" + id.length + ".json";
}

export function elementPath(id: string): string {
  return GRAPH_POSITIONS_DIR + "/" + elementFileName(id);
}

export function bendPath(edgeId: string): string {
  return GRAPH_BENDS_DIR + "/" + elementFileName(edgeId);
}

function positionText(id: string, position: GraphPosition): string {
  return (
    JSON.stringify({ id, x: roundCoordinate(position.x), y: roundCoordinate(position.y) }) + "\n"
  );
}

function readPositionedMap(
  files: Readonly<Record<string, string>> | undefined,
): Map<string, GraphPosition> {
  const positions = new Map<string, GraphPosition>();
  for (const text of Object.values(files ?? {})) {
    const entry = readPositioned(parseJson(text));
    if (entry !== null) positions.set(entry.id, entry.position);
  }
  return positions;
}

function invalid(): ParsedGraphLayout {
  return { layout: emptyGraphLayout(), source: "invalid" };
}

/**
 * Decode the files. A missing or blank set is "missing" (the automatic layout applies); a
 * present but malformed settings file is "invalid" so the panel can say so. A corrupt element
 * file is skipped: one bad file must not lose the rest of the graph.
 */
export function decodeGraphLayout(files: GraphLayoutFiles): ParsedGraphLayout {
  const layoutText = blankToNull(files.layout);
  const viewportText = blankToNull(files.viewport);
  const notes = files.notes ?? {};
  const hasState =
    layoutText !== null ||
    viewportText !== null ||
    Object.keys(files.positions ?? {}).length > 0 ||
    Object.keys(files.bends ?? {}).length > 0 ||
    Object.keys(notes).length > 0;
  if (!hasState) {
    // Migration: v1/v2 kept everything in `.facilis/graph.json`; the next save writes v3.
    const legacy = blankToNull(files.legacy);
    return legacy === null
      ? { layout: emptyGraphLayout(), source: "missing" }
      : parseGraphLayout(legacy);
  }
  let hiddenEdges: GraphEdgeKind[] = [];
  let hideSystemRoutes = false;
  let hideSystemTables = false;
  let collapsed: Record<string, boolean> = {};
  if (layoutText !== null) {
    const raw = parseJson(layoutText);
    if (!isRecord(raw) || raw.version !== GRAPH_LAYOUT_VERSION) return invalid();
    hiddenEdges = readEdgeKinds(raw.hiddenEdges);
    // Additive since D-163: a layout written before the system filters shows everything.
    hideSystemRoutes = raw.hideSystemRoutes === true;
    hideSystemTables = raw.hideSystemTables === true;
    collapsed = readCollapsed(raw.collapsed);
  }
  const positions = readPositionedMap(files.positions);
  const graphNodes: Record<string, GraphPosition> = {};
  for (const [id, position] of positions) {
    if (!isNoteId(id)) graphNodes[id] = position;
  }
  const edgeCurves: Record<string, GraphCurve> = {};
  for (const [id, position] of readPositionedMap(files.bends)) edgeCurves[id] = position;
  const layoutNotes: Record<string, GraphNote> = {};
  for (const [id, text] of Object.entries(notes)) {
    // Only ids we can round-trip as a file name: a stray file must not become a ghost note.
    if (noteFilePath(id) === null) continue;
    const position = positions.get(id) ?? NOTE_FALLBACK;
    layoutNotes[id] = { id, x: position.x, y: position.y, text };
  }
  const viewport = viewportText === null ? null : readViewport(parseJson(viewportText));
  return {
    layout: {
      version: GRAPH_LAYOUT_VERSION,
      nodes: graphNodes,
      hiddenEdges,
      hideSystemRoutes,
      hideSystemTables,
      collapsed,
      edgeCurves,
      notes: layoutNotes,
      ...(viewport === null ? {} : { viewport }),
    },
    source: "ok",
  };
}

function sortedRecord<T>(
  record: Readonly<Record<string, T>>,
  map: (value: T) => unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, value] of sortedEntries(record)) out[id] = map(value);
  return out;
}

/** One trailing newline, no blank lines: stable bytes so git sees only real edits. */
function markdownBody(text: string): string {
  const trimmed = text.replace(/\n+$/u, "");
  return trimmed === "" ? "" : trimmed + "\n";
}

/** Every v3 file for a layout; the IO layer writes them, the panel never touches them. */
export function encodeGraphLayout(layout: GraphLayoutFile): readonly GraphLayoutWrite[] {
  const writes: GraphLayoutWrite[] = [
    {
      path: GRAPH_LAYOUT_PATH,
      contents:
        JSON.stringify(
          {
            version: GRAPH_LAYOUT_VERSION,
            hiddenEdges: GRAPH_EDGE_KINDS.filter((kind) => layout.hiddenEdges.includes(kind)),
            hideSystemRoutes: layout.hideSystemRoutes,
            hideSystemTables: layout.hideSystemTables,
            collapsed: sortedRecord(layout.collapsed, (value) => value),
          },
          null,
          2,
        ) + "\n",
    },
  ];
  for (const [id, position] of sortedEntries(layout.nodes)) {
    writes.push({ path: elementPath(id), contents: positionText(id, position) });
  }
  for (const [id, note] of sortedEntries(layout.notes)) {
    writes.push({ path: elementPath(id), contents: positionText(id, note) });
    const notePath = noteFilePath(id);
    if (notePath !== null) writes.push({ path: notePath, contents: markdownBody(note.text) });
  }
  for (const [id, curve] of sortedEntries(layout.edgeCurves)) {
    writes.push({ path: bendPath(id), contents: positionText(id, curve) });
  }
  const viewport = layout.viewport;
  writes.push({
    path: GRAPH_VIEWPORT_PATH,
    contents:
      viewport === undefined
        ? ""
        : JSON.stringify({
            x: roundCoordinate(viewport.x),
            y: roundCoordinate(viewport.y),
            zoom: roundCoordinate(viewport.zoom),
          }) + "\n",
  });
  return writes;
}

/** `note:<uuid>` → `notes/<uuid>.md`; null when the id is not a note id we can store. */
export function noteFilePath(noteId: string): string | null {
  if (!isNoteId(noteId)) return null;
  const uuid = noteId.slice(GRAPH_NOTE_PREFIX.length);
  return isNoteUuid(uuid) ? GRAPH_NOTES_DIR + "/" + uuid + ".md" : null;
}

/** `<uuid>.md` → `note:<uuid>`; null for files we do not own. */
export function noteIdFromFileName(fileName: string): string | null {
  if (!fileName.endsWith(".md")) return null;
  const uuid = fileName.slice(0, -3);
  return isNoteUuid(uuid) ? GRAPH_NOTE_PREFIX + uuid : null;
}
