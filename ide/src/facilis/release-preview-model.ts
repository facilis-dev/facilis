// The Release Preview's pure view model (SPEC §11.3, D-086).
//
// Free of React, git and fetch so the two things that are easy to get wrong stay
// unit-testable without a DOM or a repository: the three lens presets (which refs to
// compare, and why a lens cannot be offered) and the rendered shape of a ReleasePreview.

import type {
  ApiDiff,
  ApiRouteChange,
  ApiRouteRef,
  BreakingChange,
  GitRef,
  MigrationStatement,
  ReleasePreview,
  ReleaseWarning,
  RiskClass,
  SchemaDiffSummary,
  SecurityDiff,
} from "./release-engine";

export type ReleaseLensId = "working" | "remote" | "tag";

/** Display order of the three git lenses (the fourth view is the code↔live card). */
export const RELEASE_LENSES: readonly ReleaseLensId[] = ["working", "remote", "tag"];

/** The pseudo-ref the working-copy lens uses as its "to" side; never resolved by git. */
export const WORKTREE_REF = "WORKTREE";

/** What git knows about the repository, as listReleaseRefs() reports it. */
export interface ReleaseRefInventory {
  readonly head: GitRef | null;
  readonly currentBranch: string | null;
  readonly branches: readonly string[];
  readonly tags: readonly string[];
}

/** The inventory before the first git read: every lens unavailable, nothing guessed. */
export const EMPTY_REF_INVENTORY: ReleaseRefInventory = {
  head: null,
  currentBranch: null,
  branches: [],
  tags: [],
};

/** Why a lens cannot be offered; the panel turns it into a sentence. */
export type ReleaseLensUnavailable = "no-head" | "remote-missing" | "tag-missing";

export interface ReleaseLensPreset {
  readonly id: ReleaseLensId;
  /** Ref name to resolve, or null when the lens is unavailable. */
  readonly from: string | null;
  readonly to: string | null;
  readonly reason: ReleaseLensUnavailable | null;
}

export interface ReleaseLensOptions {
  /** `release.ref` from facilis.config.ts; overrides "the newest tag". */
  readonly releaseRef?: string | null;
}

export function lensPresets(
  refs: ReleaseRefInventory,
  options: ReleaseLensOptions = {},
): ReleaseLensPreset[] {
  return RELEASE_LENSES.map((id) => lensPreset(id, refs, options));
}

export function lensPreset(
  id: ReleaseLensId,
  refs: ReleaseRefInventory,
  options: ReleaseLensOptions = {},
): ReleaseLensPreset {
  switch (id) {
    case "working":
      return refs.head === null
        ? unavailable(id, "no-head")
        : { id, from: "HEAD", to: WORKTREE_REF, reason: null };
    case "remote":
      return remotePreset(refs);
    case "tag":
      return tagPreset(refs, options);
  }
}

function remotePreset(refs: ReleaseRefInventory): ReleaseLensPreset {
  if (refs.head === null) return unavailable("remote", "no-head");
  const branch = refs.currentBranch ?? "main";
  const own = "origin/" + branch;
  const candidate = refs.branches.includes(own) ? own : "origin/main";
  if (!refs.branches.includes(candidate)) return unavailable("remote", "remote-missing");
  return { id: "remote", from: candidate, to: "HEAD", reason: null };
}

function tagPreset(refs: ReleaseRefInventory, options: ReleaseLensOptions): ReleaseLensPreset {
  const from = options.releaseRef ?? newestTag(refs.tags);
  if (from === null || from.length === 0) return unavailable("tag", "tag-missing");
  const to = refs.branches.includes("origin/main") ? "origin/main" : "HEAD";
  if (to === "HEAD" && refs.head === null) return unavailable("tag", "no-head");
  return { id: "tag", from, to, reason: null };
}

/** The newest tag by natural version order ("v0.10.0" after "v0.9.0"). */
export function newestTag(tags: readonly string[]): string | null {
  if (tags.length === 0) return null;
  return (
    [...tags].toSorted((left, right) => left.localeCompare(right, undefined, { numeric: true })).at(-1) ??
    null
  );
}

function unavailable(id: ReleaseLensId, reason: ReleaseLensUnavailable): ReleaseLensPreset {
  return { id, from: null, to: null, reason };
}

// ── rendered diff ─────────────────────────────────────────────────────────────────

export type ReleaseRiskCounts = {
  readonly [risk in RiskClass]: number;
} & { readonly total: number };

export interface ReleasePreviewView {
  readonly from: GitRef;
  readonly to: GitRef;
  readonly generatedAt: string;
  readonly summary: SchemaDiffSummary;
  readonly counts: ReleaseRiskCounts;
  readonly statements: readonly MigrationStatement[];
  readonly api: ApiDiff;
  readonly security: SecurityDiff;
  readonly breaking: readonly BreakingChange[];
  readonly warnings: readonly ReleaseWarning[];
  /** Nothing at all changed between the two sides. */
  readonly empty: boolean;
}

const EMPTY_API: ApiDiff = { added: [], removed: [], changed: [] };

export function buildReleaseView(preview: ReleasePreview): ReleasePreviewView {
  const api = preview.api ?? EMPTY_API;
  const counts = countRisks(preview.schema.statements);
  return {
    from: preview.from,
    to: preview.to,
    generatedAt: preview.generatedAt,
    summary: preview.schema.summary,
    counts,
    statements: preview.schema.statements,
    api,
    security: preview.security,
    breaking: preview.breaking,
    warnings: preview.warnings,
    empty: isEmpty(preview, api, counts),
  };
}

function countRisks(statements: readonly MigrationStatement[]): ReleaseRiskCounts {
  const counts: Record<RiskClass, number> = { safe: 0, careful: 0, destructive: 0, breaking: 0 };
  for (const statement of statements) counts[statement.risk] += 1;
  return { ...counts, total: statements.length };
}

function isEmpty(preview: ReleasePreview, api: ApiDiff, counts: ReleaseRiskCounts): boolean {
  const summary = preview.schema.summary;
  const declared =
    summary.addedTables +
    summary.droppedTables +
    summary.addedColumns +
    summary.droppedColumns +
    summary.alteredColumns +
    summary.addedPolicies +
    summary.droppedPolicies +
    summary.alteredPolicies;
  const security =
    preview.security.policiesAdded.length +
    preview.security.policiesDropped.length +
    preview.security.policiesChanged.length +
    preview.security.rlsDisabled.length;
  return (
    declared === 0 &&
    counts.total === 0 &&
    api.added.length === 0 &&
    api.removed.length === 0 &&
    api.changed.length === 0 &&
    preview.breaking.length === 0 &&
    preview.warnings.length === 0 &&
    security === 0
  );
}

/** Stable display label for a route ref, used by both the API section and jump-to. */
export function routeLabel(route: ApiRouteRef): string {
  return route.method.toUpperCase() + " " + route.path;
}

export function changedRouteLabel(change: ApiRouteChange): { before: string; after: string } {
  return { before: routeLabel(change.before), after: routeLabel(change.after) };
}
