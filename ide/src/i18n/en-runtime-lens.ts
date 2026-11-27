// English strings for the runtime (live) graph lens (D-224, epic #196, issue #199). Split
// from the project-graph catalogue, which is at the 300-line source limit; keys stay flat.
export const runtimeLensEn = {
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
};
