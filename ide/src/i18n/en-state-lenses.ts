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

  // ── prerender lens (#202) ───────────────────────────────────────────────────
  "projectGraph.surface.lens.prerender": "Q21 · Prerender",
  "projectGraph.surface.lens.prerender.short": "Q21",
  "projectGraph.surface.lens.prerender.description":
    "Which pages prerender at build time: declared and eligible, eligible but undeclared, or blocked with the analyzer's reason.",
  "projectGraph.surface.state.prerendered": "Prerendered: {path} is declared and eligible.",
  "projectGraph.surface.state.prerendered.label": "Prerendered",
  "projectGraph.surface.state.prerendered.short": "PR",
  "projectGraph.surface.state.prerenderEligible":
    "Eligible but not declared: add {path} to the prerender allowlist.",
  "projectGraph.surface.state.prerenderEligible.label": "Eligible, not declared",
  "projectGraph.surface.state.prerenderEligible.short": "EL",
  "projectGraph.surface.state.privateApi":
    "Calls {route}, which requires a permission, so the page cannot prerender.",
  "projectGraph.surface.state.privateApi.label": "Private API",
  "projectGraph.surface.state.privateApi.short": "API",
  "projectGraph.surface.state.authGuarded": "The page is behind authentication.",
  "projectGraph.surface.state.authGuarded.label": "Auth-guarded",
  "projectGraph.surface.state.authGuarded.short": "AUTH",
  "projectGraph.surface.state.unknownSecurity":
    "A dependency's security could not be read statically.",
  "projectGraph.surface.state.unknownSecurity.label": "Unknown security",
  "projectGraph.surface.state.unknownSecurity.short": "?",
  "projectGraph.surface.state.dynamicPath":
    "The path has a dynamic parameter, so it has no single prerendered URL.",
  "projectGraph.surface.state.dynamicPath.label": "Dynamic path",
  "projectGraph.surface.state.dynamicPath.short": "DYN",
  "projectGraph.surface.state.redirect": "The page redirects instead of rendering.",
  "projectGraph.surface.state.redirect.label": "Redirect",
  "projectGraph.surface.state.redirect.short": "RDR",
  "projectGraph.surface.state.prerenderIneligible":
    "Ineligible, but the analyzer named no blocker.",
  "projectGraph.surface.state.prerenderIneligible.label": "Ineligible",
  "projectGraph.surface.state.prerenderIneligible.short": "!",
  "projectGraph.surface.state.prerenderUnknown":
    "No prerender fact for {path}; the analyzer could not decide.",
  "projectGraph.surface.state.prerenderUnknown.label": "Unknown",
  "projectGraph.surface.state.prerenderUnknown.short": "?",
  "projectGraph.surface.state.noPages": "No routed page to evaluate for prerender.",
  "projectGraph.surface.state.noPages.label": "No pages",
  "projectGraph.surface.state.prerender.totals":
    "pages: {count} · prerendered: {prerendered} · eligible: {eligible} · ineligible: {ineligible} · unknown: {unknown}",
  "projectGraph.surface.state.prerender.emptyHint":
    "Add a route to a page, or open the inspector to see the analyzer's prerender facts.",

  // ── lens palette and picker (#204) ──────────────────────────────────────────
  "palette.lens": "Lens: {lens}",
  "projectGraph.surface.lens.picker.title": "Lens picker",
  "projectGraph.surface.lens.picker.hint":
    "1–{count} picks a lens · Enter confirms · Esc closes without changing the active lens.",
};
