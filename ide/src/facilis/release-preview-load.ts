// Orchestrates one Release Preview lens load (SPEC §11.3, D-086) for the panel.
//
// The panel itself stays about rendering: this module resolves which refs the lens compares,
// reads the two snapshots out of git (or the live VFS for the working copy), merges the
// manifest's route metadata and hands the pair to the pure engine. Nothing here throws —
// every failure comes back as a `problem` the panel renders, so a broken repository or a
// missing remote never takes the editor down.

import type { PrerenderEligibilityFact } from "@facilis.dev/analyze";
import { analyzeProjectFiles, loadProjectAnalysis } from "./analyze-client";
import { buildReleasePreview } from "./release-engine";
import { diffPrerenderSurfaces, type PrerenderSurfaceDiff } from "./release-prerender";
import type { GitRef, ReleasePreview, ReleaseRouteFact } from "./release-engine";
import type { IdeController } from "@/vv/controller";
import { createGitFs } from "@/vv/git-fs";
import { fetchManifest } from "./manifest-client";
import { parseManifestRoutes } from "./release-routes";
import {
  lensPreset,
  WORKTREE_REF,
  type ReleaseLensId,
  type ReleaseLensPreset,
  type ReleaseLensUnavailable,
  type ReleaseRefInventory,
} from "./release-preview-model";
import {
  listReleaseRefs,
  readPrerenderFactsAt,
  readSnapshotAt,
  readWorkingSnapshot,
  resolveReleaseRef,
} from "./release-git";

export type ReleaseLoadProblem =
  "no-project" | ReleaseLensUnavailable | "ref-missing" | "snapshot-missing" | "engine";

export interface ReleaseLensLoad {
  readonly refs: ReleaseRefInventory;
  readonly preset: ReleaseLensPreset;
  readonly from: GitRef | null;
  readonly to: GitRef | null;
  readonly preview: ReleasePreview | null;
  /** Per-page render-mode diff (D-202, issue #84); null when either side is unreadable. */
  readonly prerenderDiff: PrerenderSurfaceDiff | null;
  readonly problem: ReleaseLoadProblem | null;
  /** The ref the problem is about, so the panel can name it. */
  readonly problemRef: string | null;
}

export interface ReleaseLoadOptions {
  readonly lens: ReleaseLensId;
  /** Preview-proxy base, used to read the manifest's route metadata (nullable). */
  readonly base: string | null;
  readonly releaseRef?: string | null;
}

const NOTHING: ReleaseRefInventory = {
  head: null,
  currentBranch: null,
  branches: [],
  tags: [],
};

export async function loadReleaseLens(
  controller: IdeController,
  options: ReleaseLoadOptions,
): Promise<ReleaseLensLoad> {
  const root = controller.activeFolder?.rootPath ?? null;
  if (root === null) return failed(NOTHING, lensPreset(options.lens, NOTHING), "no-project", null);

  const fs = createGitFs(controller.bridge);
  const refs = await listReleaseRefs(root, fs);
  const releaseRef =
    options.releaseRef ??
    (options.lens === "tag" ? await configuredReleaseRef(controller, root) : null);
  const preset = lensPreset(options.lens, refs, { releaseRef });
  if (preset.from === null || preset.to === null || preset.reason !== null) {
    return failed(refs, preset, preset.reason ?? "ref-missing", preset.from ?? preset.to);
  }

  const routeMetadata = await readManifestRoutes(options.base);
  const from = await resolveReleaseRef(root, preset.from, fs);
  if (from === null) return failed(refs, preset, "ref-missing", preset.from);

  const to =
    preset.id === "working" ? workingCopyRef(refs) : await resolveReleaseRef(root, preset.to, fs);
  if (to === null) {
    return failed(refs, preset, preset.id === "working" ? "no-head" : "ref-missing", preset.to);
  }

  const before = await readSnapshotAt(root, preset.from, fs, analyzeProjectFiles);
  if (before === null) return failed(refs, preset, "snapshot-missing", preset.from);
  const after =
    preset.id === "working"
      ? await readWorkingSnapshot(
          controller,
          analyzeProjectFiles,
          routeMetadata.length > 0 ? routeMetadata : undefined,
        )
      : await readSnapshotAt(root, to.ref, fs, analyzeProjectFiles);
  if (after === null) return failed(refs, preset, "snapshot-missing", preset.to);

  const prerenderDiff = await loadPrerenderDiff(controller, root, preset, fs);

  try {
    const preview = buildReleasePreview({
      from,
      to,
      before,
      after,
      ...(routeMetadata.length === 0 ? {} : { inUseRoutes: routeMetadata }),
    });
    return { refs, preset, from, to, preview, prerenderDiff, problem: null, problemRef: null };
  } catch {
    return failed(refs, preset, "engine", preset.to);
  }
}

/**
 * The prerender surface on both sides of the lens (issue #84). The working copy reuses the
 * cached live analysis; a git ref reads the full analysis surface at that ref. Either side
 * unreadable -> null -> the panel says "unavailable" (fail closed, D-092).
 */
async function loadPrerenderDiff(
  controller: IdeController,
  root: string,
  preset: ReleaseLensPreset,
  fs: ReturnType<typeof createGitFs>,
): Promise<PrerenderSurfaceDiff | null> {
  if (preset.from === null || preset.to === null) return null;
  const before = await readPrerenderFactsAt(root, preset.from, fs, analyzeProjectFiles);
  let after: readonly PrerenderEligibilityFact[] | null;
  if (preset.id === "working") {
    const result = await loadProjectAnalysis(controller);
    after = result.ok ? result.analysis.prerender : null;
  } else {
    after = await readPrerenderFactsAt(root, preset.to, fs, analyzeProjectFiles);
  }
  return diffPrerenderSurfaces(before, after);
}

/** The working-copy side of the first lens: a label plus HEAD's oid, never a git ref. */
function workingCopyRef(refs: ReleaseRefInventory): GitRef | null {
  const head = refs.head;
  if (head === null) return null;
  return { kind: "commit", ref: WORKTREE_REF, oid: head.oid };
}

/**
 * `release.ref` from the project's facilis.config.ts, when it names one: the tag lens
 * prefers it over "the newest tag" (SPEC §11.3). Non-fatal — an unreadable or absent
 * config just means "use the newest tag".
 */
async function configuredReleaseRef(
  controller: IdeController,
  root: string,
): Promise<string | null> {
  try {
    const source = await controller.readFileText(root + "/facilis.config.ts");
    const match = /release\s*:\s*\{[^}]*\bref\s*:\s*["'`]([^"'`]+)["'`]/s.exec(source);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function readManifestRoutes(base: string | null): Promise<ReleaseRouteFact[]> {
  if (base === null) return [];
  const result = await fetchManifest(base, { sections: ["routes"] });
  if (!result.ok) return [];
  return parseManifestRoutes(result.envelope.manifest["routes"]);
}

function failed(
  refs: ReleaseRefInventory,
  preset: ReleaseLensPreset,
  problem: ReleaseLoadProblem,
  problemRef: string | null,
): ReleaseLensLoad {
  return {
    refs,
    preset,
    from: null,
    to: null,
    preview: null,
    prerenderDiff: null,
    problem,
    problemRef,
  };
}
