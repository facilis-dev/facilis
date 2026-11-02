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
} as const;
