// English strings for the state lenses (D-224, epic #196): runtime (#199) and changes
// (#200). Split from the project-graph catalogue, which is at the 300-line source limit; keys
// stay flat.
export const stateLensesEn = {
  "projectGraph.surface.lens.runtime": "Q18 · Runtime",
  "projectGraph.surface.lens.runtime.short": "Q18",
  "projectGraph.surface.lens.runtime.description":
    "Per-route samples from the running preview: requests, 5xx rate and p50/p95 latency. Live in a dev build only.",

  "projectGraph.surface.state.notRunning.label": "Not running",
  "projectGraph.surface.state.noTraffic":
    "No request reached any route in the last {minutes} minutes.",
  "projectGraph.surface.state.noTraffic.label": "No traffic",
  "projectGraph.surface.state.routeErrors":
    "{errors} of {total} requests failed with a 5xx ({rate}%).",
  "projectGraph.surface.state.routeErrors.label": "Server errors",
  "projectGraph.surface.state.slowRoute":
    "p95 is {p95} ms, above the {threshold} ms slow-route threshold.",
  "projectGraph.surface.state.slowRoute.label": "Slow route",
  "projectGraph.surface.state.title": "Live signals",
  "projectGraph.surface.state.badge": "{requests} req · {errors} err",
  "projectGraph.surface.state.totals": "{count} requests · {errors} errors",
  "projectGraph.surface.state.window": "Last {minutes} minutes",
  "projectGraph.surface.state.devOnly": "Runtime samples exist only in a dev build.",
  "projectGraph.surface.state.emptyTitle": "No traffic yet",
  "projectGraph.surface.state.emptyHint":
    "Open the preview and send a request, or reload a page: the route cards fill in within a second.",

  // ── changes lens (#200) ─────────────────────────────────────────────────────
  "projectGraph.surface.lens.changes": "Q19 · Changes",
  "projectGraph.surface.lens.changes.short": "Q19",
  "projectGraph.surface.lens.changes.description":
    "The working tree against the checkpoint (HEAD): modified, added and deleted files map to the nodes that own them. Read-only.",
  "projectGraph.surface.state.noChanges": "The working tree matches the checkpoint.",
  "projectGraph.surface.state.noChanges.label": "No changes",
  "projectGraph.surface.state.fileModified": "Modified since the checkpoint: {path}.",
  "projectGraph.surface.state.fileModified.label": "Modified",
  "projectGraph.surface.state.fileModified.short": "M",
  "projectGraph.surface.state.fileAdded": "Added since the checkpoint: {path}.",
  "projectGraph.surface.state.fileAdded.label": "Added",
  "projectGraph.surface.state.fileAdded.short": "A",
  "projectGraph.surface.state.fileDeleted": "Deleted since the checkpoint: {path}.",
  "projectGraph.surface.state.fileDeleted.label": "Deleted",
  "projectGraph.surface.state.fileDeleted.short": "D",
  "projectGraph.surface.state.changes.totals":
    "{count} changed · {modified} modified · {added} added · {deleted} deleted",
  "projectGraph.surface.state.changes.base": "vs {ref}",
  "projectGraph.surface.state.changes.loading": "Reading the working tree…",
  "projectGraph.surface.state.changes.emptyTitle": "No changes",
  "projectGraph.surface.state.changes.emptyHint":
    "Edit a source file or let the agent write one: the nodes it owns light up here. Nothing is committed.",
  "projectGraph.surface.state.noRepo":
    "This project is not a git repository, so there is no checkpoint to compare.",
  "projectGraph.surface.state.changes.error": "Could not read the working tree.",
  "projectGraph.surface.state.noHead":
    "This repository has no commit yet, so there is no checkpoint to compare.",

  // ── reach lens (#201) ───────────────────────────────────────────────────────
  "projectGraph.surface.lens.reach": "Q20 · Reach",
  "projectGraph.surface.lens.reach.short": "Q20",
  "projectGraph.surface.lens.reach.description":
    "What one declared role can call: the routes its permissions unlock, the pages that reach them and the tables they declare. Read-only.",
  "projectGraph.surface.state.noRoles":
    "facilis.config.ts declares no roles, so there is nothing to reach.",
  "projectGraph.surface.state.noRoles.label": "No roles",
  "projectGraph.surface.state.publicRoute":
    "Public route: no permission is required, so every role reaches it.",
  "projectGraph.surface.state.publicRoute.label": "Public route",
  "projectGraph.surface.state.publicRoute.short": "PUB",
  "projectGraph.surface.state.reachableRoute": "Reachable with {permission}.",
  "projectGraph.surface.state.reachableRoute.label": "Reachable route",
  "projectGraph.surface.state.undeclaredPermission":
    "Requires {permission}, which no declared role holds.",
  "projectGraph.surface.state.undeclaredPermission.label": "Undeclared permission",
  "projectGraph.surface.state.undeclaredPermission.short": "?",
  "projectGraph.surface.state.wildcardRole":
    "Role {role} holds the wildcard, so it expands to every declared permission.",
  "projectGraph.surface.state.wildcardRole.label": "Wildcard role",
  "projectGraph.surface.state.elevatedRoute":
    "Also reaches its data through audited sudo/system elevation.",
  "projectGraph.surface.state.elevatedRoute.label": "Elevated access",
  "projectGraph.surface.state.elevatedRoute.short": "SUDO",
  "projectGraph.surface.state.noReach": "No route is reachable with the permissions of {role}.",
  "projectGraph.surface.state.noReach.label": "No reachable route",
  "projectGraph.surface.state.reach.totals": "{count} routes · pages: {pages} · tables: {tables}",
  "projectGraph.surface.state.reach.context": "Role {role}",
  "projectGraph.surface.state.reach.role": "Role",
  "projectGraph.surface.state.reach.emptyHint":
    "Pick another role, or declare the missing permission in facilis.config.ts.",
};
