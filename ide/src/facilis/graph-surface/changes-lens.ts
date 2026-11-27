// The changes lens's facts (D-224, Q19): the working tree against the D-181 checkpoint,
// mapped from file paths to the graph nodes that own them. Pure and read-only: a change is
// never placed, never re-analyzed, and a deleted file's node is only marked where the layout
// already put it.

import type { WorktreeSnapshot } from "@/ai/git-checkpoint";
import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphView } from "../graph-model";
import type { GraphStateCode } from "./lenses.ts";
import type { GraphLensState, GraphStateFact } from "./state-facts.ts";

type ChangeLetter = "A" | "D" | "M";

const KIND: Readonly<
  Record<
    ChangeLetter,
    { code: GraphStateCode; labelKey: MessageKey; shortKey: MessageKey; token: string }
  >
> = {
  M: {
    code: "state.fileModified",
    labelKey: "projectGraph.surface.state.fileModified.label",
    shortKey: "projectGraph.surface.state.fileModified.short",
    token: "--warning",
  },
  A: {
    code: "state.fileAdded",
    labelKey: "projectGraph.surface.state.fileAdded.label",
    shortKey: "projectGraph.surface.state.fileAdded.short",
    token: "--success",
  },
  D: {
    code: "state.fileDeleted",
    labelKey: "projectGraph.surface.state.fileDeleted.label",
    shortKey: "projectGraph.surface.state.fileDeleted.short",
    token: "--destructive",
  },
};

function nodeIdsByFile(view: ProjectGraphView | null): ReadonlyMap<string, readonly string[]> {
  const byFile = new Map<string, string[]>();
  for (const node of view?.nodes ?? []) {
    if (node.sourceFile === null || node.sourceFile.length === 0) continue;
    const ids = byFile.get(node.sourceFile) ?? [];
    ids.push(node.id);
    byFile.set(node.sourceFile, ids);
  }
  return byFile;
}

function emptyState(
  emptyKey: MessageKey,
  params: GraphLensState["params"],
  emptyHintKey: MessageKey | null = null,
): GraphLensState {
  return {
    facts: [],
    totals: null,
    params,
    contextKey: null,
    emptyKey,
    emptyHintKey,
    badges: new Map(),
  };
}

/** Map one read-only snapshot onto the drawn graph; null means the walk has not landed yet. */
export function buildChangesLensState(
  snapshot: WorktreeSnapshot | null,
  view: ProjectGraphView | null,
): GraphLensState {
  if (snapshot === null) return emptyState("projectGraph.surface.state.changes.loading", {});
  if (snapshot.failure === "no-repo") return emptyState("projectGraph.surface.state.noRepo", {});
  if (snapshot.failure === "no-head") return emptyState("projectGraph.surface.state.noHead", {});
  if (snapshot.failure === "error") {
    return emptyState("projectGraph.surface.state.changes.error", {});
  }
  const byFile = nodeIdsByFile(view);
  const facts: GraphStateFact[] = [];
  const badges = new Map<string, { text: string; colorToken: string }>();
  let modified = 0;
  let added = 0;
  let deleted = 0;
  for (const change of snapshot.changes) {
    if (change.letter === "A") added += 1;
    else if (change.letter === "D") deleted += 1;
    // An unmerged path (conflict) is a modification to the lens: it has no separate code.
    else modified += 1;
    const kind = KIND[change.letter === "U" ? "M" : change.letter];
    const nodeIds = byFile.get(change.path) ?? [];
    if (nodeIds.length === 0) {
      // No cached node: the file is listed by path in the answers, never placed on the map.
      facts.push({ nodeId: change.path, code: kind.code, params: { path: change.path } });
    }
    for (const nodeId of nodeIds) {
      facts.push({ nodeId, code: kind.code, params: { path: change.path } });
      badges.set(nodeId, { text: t(kind.shortKey), colorToken: kind.token });
    }
  }
  const ref = snapshot.base === null ? "HEAD" : snapshot.base.slice(0, 7);
  return {
    facts,
    totals: {
      key: "projectGraph.surface.state.changes.totals",
      count: snapshot.changes.length,
      params: { modified, added, deleted },
    },
    params: { ref },
    contextKey: snapshot.base === null ? null : "projectGraph.surface.state.changes.base",
    emptyKey: snapshot.changes.length === 0 ? "projectGraph.surface.state.noChanges" : null,
    emptyHintKey:
      snapshot.changes.length === 0 ? "projectGraph.surface.state.changes.emptyHint" : null,
    badges,
  };
}
