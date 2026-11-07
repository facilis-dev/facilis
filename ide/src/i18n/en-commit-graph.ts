// The commit-graph strings (D-088), spread into `en` in en.ts.
//
// The catalogue sits at the 300-line limit, so this feature block lives in its own module
// instead of growing en.ts — same rule as en-data-explorer.ts. Keys stay flat.
export const commitGraphEn = {
  "commitGraph.tabTitle": "Commit Graph",
  "commitGraph.open": "Open commit graph",
  "commitGraph.title": "Commit Graph",
  "commitGraph.refresh": "Refresh the graph",
  "commitGraph.focus": "Focus: hide the side panels",
  "commitGraph.unfocus": "Restore the side panels",
  "commitGraph.loading": "Reading the commit graph…",
  "commitGraph.error": "Could not read the commit graph: {error}",
  "commitGraph.notRepo": "This folder is not a git repository.",
  "commitGraph.empty": "No commits yet.",
  "commitGraph.emptyHint": "The graph fills in as soon as the repository has a commit.",
  "commitGraph.stats": "{commits} commit(s) · {branches} branch(es) · {lanes} lane(s)",
  "commitGraph.legend": "Legend",
  "commitGraph.legendCommit": "commit",
  "commitGraph.legendBranch": "branch tip",
  "commitGraph.legendHead": "HEAD (current branch)",
  "commitGraph.head": "HEAD",
  "commitGraph.hint": "Click a commit for its details; drag to pan, scroll to zoom.",
  "commitGraph.details": "Commit details",
  "commitGraph.detailsClose": "Close details",
  "commitGraph.detailsAuthor": "Author",
  "commitGraph.detailsDate": "Date",
  "commitGraph.detailsOid": "Commit",
  "commitGraph.detailsBranches": "Branches",
  "commitGraph.detailsNone": "No branch points at this commit.",
  "commitGraph.openBranch": "Check out {branch}",
} as const;
