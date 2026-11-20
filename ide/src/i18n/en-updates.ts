// The project-update strings (D-065), spread into `en` in en.ts.
//
// Kept in their own module because the catalogue sits at the 300-line-per-file limit —
// the same split as en-data-explorer.ts, en-git-remote.ts and en-release-preview.ts.
export const updatesEn = {
  "updates.available": "Update available",
  "updates.aheadBadge": "Newer project",
  "updates.tooltip": "Project {project} · this Studio {build}",
  "updates.title": "Project updates",
  "updates.description": "This project was created by an older build of the Studio.",
  "updates.ahead": "This project was created by a newer Studio. Open it there.",
  "updates.projectVersion": "Project version",
  "updates.buildVersion": "This Studio",
  "updates.unknown": "unknown",
  "updates.noRecipe":
    "This Studio ships no upgrade recipe for this jump yet, so nothing is applied automatically. Export the project and recreate it from the current template, or use a build that includes the recipe.",
  "updates.baseline": "Approved baseline: {baseline}",
  // The D-198 framework-minimum boot gate (framework-gate.ts / FrameworkGateDialog.tsx).
  "updates.frameworkMinimum.title": "Update framework packages to this build's minimum versions",
  "updates.framework.blockedTitle": "Framework packages are out of date",
  "updates.framework.blockedDescription":
    "This project pins @facilis.dev/* packages below the minimum versions this Studio requires, so it cannot start until they are updated.",
  "updates.framework.belowRow": "{name}: {pinned} → minimum {minimum}",
  "updates.framework.update": "Update framework packages",
  "updates.framework.decline": "Not now",
  "updates.framework.applying": "Updating package.json and reinstalling dependencies…",
  "updates.framework.declined":
    "Run refused: this project's @facilis.dev/* pins are below the build's minimums. Run again to update them.",
  "updates.framework.failed": "The framework update failed; the project was not started.",
  "updates.framework.failedRolledBack":
    "The framework update failed and was rolled back; the project was not started. Try again.",
  "updates.framework.failedNoRollback":
    "The framework update failed and the rollback was incomplete — check the project files before running it again.",
  "updates.framework.retry": "Try again",
  "updates.framework.close": "Close",
} as const;
