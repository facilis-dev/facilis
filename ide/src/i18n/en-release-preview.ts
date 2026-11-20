// The Release Preview strings (SPEC §11.3, D-086), spread into `en` in en.ts.
//
// Kept in their own module because the catalogue sits at the 300-line limit — same rule as
// en-data-explorer.ts and en-git-remote.ts. Keys stay flat and every dynamic value is a
// {placeholder}.
export const releasePreviewEn = {
  "activity.release": "Release Preview",

  "releasePreview.title": "Release Preview",
  "releasePreview.refresh": "Refresh release preview",
  "releasePreview.loading": "Reading the release snapshots…",
  "releasePreview.retry": "Try again",
  "releasePreview.noProject": "Open a project first.",
  "releasePreview.worktree": "working copy",
  "releasePreview.compare": "{from} → {to}",
  "releasePreview.empty": "Nothing changed between {from} and {to}.",

  "releasePreview.lens.working": "Working copy",
  "releasePreview.lens.remote": "Remote",
  "releasePreview.lens.tag": "Release tag",
  "releasePreview.lens.working.hint": "Working copy ↔ HEAD — what am I about to commit?",
  "releasePreview.lens.remote.hint": "HEAD ↔ origin — what ships on the next deploy?",
  "releasePreview.lens.tag.hint": "Tag ↔ origin — what changed since the last release?",

  "releasePreview.unavailable.no-head":
    "This project has no git history yet — commit something first.",
  "releasePreview.unavailable.remote-missing":
    "No origin branch to compare with. Fetch or push the remote first.",
  "releasePreview.unavailable.tag-missing":
    "No release tag yet — tag a commit to compare against it.",
  "releasePreview.problem.no-project": "Open a project first.",
  "releasePreview.problem.ref-missing": "The ref {ref} does not resolve in this repository.",
  "releasePreview.problem.snapshot-missing": "Could not read or analyze the project tree at {ref}.",
  "releasePreview.problem.engine": "The release engine could not diff the two snapshots.",

  "releasePreview.summary.title": "Risk summary",
  "releasePreview.summary.risk": "Overall risk",
  "releasePreview.summary.schema":
    "tables +{addedTables}/-{droppedTables} · columns +{addedColumns}/-{droppedColumns} · policies +{addedPolicies}/-{droppedPolicies}",
  "releasePreview.risk.safe": "Safe",
  "releasePreview.risk.careful": "Careful",
  "releasePreview.risk.destructive": "Destructive",
  "releasePreview.risk.breaking": "Breaking",

  "releasePreview.plan.title": "Schema plan",
  "releasePreview.plan.empty": "No schema change between the two refs.",
  "releasePreview.plan.failedClosed":
    "The plan fails closed — no SQL ships until these problems are resolved.",
  "releasePreview.plan.requires": "requires {requirements}",
  "releasePreview.plan.destructive": "Destructive batches: {ids}",
  "releasePreview.planProblem.unsupported_declaration": "Unsupported declaration: {construct}",
  "releasePreview.planProblem.unsupported_change": "Unsupported change: {construct}",
  "releasePreview.planProblem.policy_unsafe": "Unsafe policy change: {construct}",

  "releasePreview.api.title": "API diff",
  "releasePreview.api.added": "Added routes",
  "releasePreview.api.removed": "Removed routes",
  "releasePreview.api.changed": "Changed routes",
  "releasePreview.api.empty": "No API change.",
  "releasePreview.api.fields": "changed: {fields}",

  "releasePreview.security.title": "Security diff",
  "releasePreview.security.policiesAdded": "Policies added",
  "releasePreview.security.policiesDropped": "Policies dropped",
  "releasePreview.security.policiesChanged": "Policies changed",
  "releasePreview.security.rlsDisabled": "RLS off on scoped tables",
  "releasePreview.security.empty": "No policy or RLS change.",
  "releasePreview.security.direction.broadened": "broadened",
  "releasePreview.security.direction.narrowed": "narrowed",
  "releasePreview.security.direction.unknown": "changed",

  "releasePreview.breaking.title": "Breaking changes",
  "releasePreview.breaking.empty": "No breaking change detected.",
  "releasePreview.breaking.routes": "used by {routes}",
  "releasePreview.breaking.dropped_table_in_use":
    "Table {table} is dropped while {count} route(s) still use it",
  "releasePreview.breaking.dropped_column_in_use":
    "Column {table}.{column} is dropped while {count} route(s) still read it",
  "releasePreview.breaking.widened_type_mismatch":
    "Column {table}.{column} changes type in a way clients may not expect",

  "releasePreview.warnings.title": "Warnings",
  "releasePreview.warnings.empty": "No warnings.",
  "releasePreview.warning.destructive_without_backfill":
    "Destructive batch {batch} ships with no backfill step",
  "releasePreview.warning.policy_broadened": "Policy {policy} is broader than before",

  "releasePreview.codeLive.title": "Code ↔ Live DB",
  "releasePreview.codeLive.loading": "Comparing db/schema.ts with the live database…",
  "releasePreview.codeLive.synced": "Code and live database are in sync.",
  "releasePreview.codeLive.drift": "{count} drift(s) between code and the live database.",
  "releasePreview.codeLive.unreachable":
    "Live database not reachable — run the project to compare.",
  "releasePreview.codeLive.open": "Open db/schema.ts",

  "releasePreview.open": "Open {path}",
} as const;
