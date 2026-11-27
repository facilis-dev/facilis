// The graph lens registry (D-220, D-225): one descriptor per lens with its fact source, keys,
// codes and legend. Split from `lenses.ts` so the code -> key/token contract and the registry
// each stay under the 300-line source limit; this module imports the code tables, never the
// reverse.

import type { MessageKey } from "@/i18n";
import {
  DIAGNOSTIC_COLOR_TOKENS,
  DIAGNOSTIC_LABEL_KEYS,
  DIAGNOSTIC_MESSAGE_KEYS,
  GRAPH_LENS_IDS,
  isStateCode,
  type GraphLensCode,
  type GraphLensDefinition,
  type GraphLensId,
  type GraphLensLegendEntry,
  type GraphLensSource,
} from "./lenses.ts";

const CODES_BY_LENS: Readonly<Record<GraphLensId, readonly GraphLensCode[]>> = {
  security: ["publicWrite", "publicAdmin", "tableNoRls"],
  elevated: ["elevated"],
  shared: ["shared"],
  unknown: ["unknown"],
  runtime: ["state.notRunning", "state.noTraffic", "state.routeErrors", "state.slowRoute"],
  changes: ["state.noChanges", "state.fileModified", "state.fileAdded", "state.fileDeleted"],
  reach: [
    "state.noRoles",
    "state.publicRoute",
    "state.reachableRoute",
    "state.undeclaredPermission",
    "state.wildcardRole",
    "state.elevatedRoute",
    "state.noReach",
  ],
  prerender: [
    "state.prerendered",
    "state.prerenderEligible",
    "state.privateApi",
    "state.authGuarded",
    "state.unknownSecurity",
    "state.dynamicPath",
    "state.redirect",
    "state.prerenderIneligible",
    "state.prerenderUnknown",
    "state.noPages",
  ],
};

const TITLE_KEYS: Readonly<Record<GraphLensId, MessageKey>> = {
  security: "projectGraph.surface.lens.security",
  elevated: "projectGraph.surface.lens.elevated",
  shared: "projectGraph.surface.lens.shared",
  unknown: "projectGraph.surface.lens.unknown",
  runtime: "projectGraph.surface.lens.runtime",
  changes: "projectGraph.surface.lens.changes",
  reach: "projectGraph.surface.lens.reach",
  prerender: "projectGraph.surface.lens.prerender",
};

const DESCRIPTION_KEYS: Readonly<Record<GraphLensId, MessageKey>> = {
  security: "projectGraph.surface.lens.security.description",
  elevated: "projectGraph.surface.lens.elevated.description",
  shared: "projectGraph.surface.lens.shared.description",
  unknown: "projectGraph.surface.lens.unknown.description",
  runtime: "projectGraph.surface.lens.runtime.description",
  changes: "projectGraph.surface.lens.changes.description",
  reach: "projectGraph.surface.lens.reach.description",
  prerender: "projectGraph.surface.lens.prerender.description",
};

const SOURCES: Readonly<Record<GraphLensId, GraphLensSource>> = {
  security: "static",
  elevated: "static",
  shared: "static",
  unknown: "static",
  runtime: "live",
  changes: "workspace",
  reach: "declared",
  prerender: "declared",
};

const SHORT_KEYS: Readonly<Record<GraphLensId, MessageKey>> = {
  security: "projectGraph.surface.lens.security.short",
  elevated: "projectGraph.surface.lens.elevated.short",
  shared: "projectGraph.surface.lens.shared.short",
  unknown: "projectGraph.surface.lens.unknown.short",
  runtime: "projectGraph.surface.lens.runtime.short",
  changes: "projectGraph.surface.lens.changes.short",
  reach: "projectGraph.surface.lens.reach.short",
  prerender: "projectGraph.surface.lens.prerender.short",
};

const LENS_COLOR_TOKENS: Readonly<Record<GraphLensId, string>> = {
  security: "--destructive",
  elevated: "--warning",
  shared: "--info",
  unknown: "--muted-foreground",
  runtime: "--success",
  changes: "--warning",
  reach: "--info",
  prerender: "--success",
};

/** Per-code legend text and colour for the IDE's own `state.*` vocabulary (D-225 §2). */
const STATE_LEGEND: Readonly<
  Record<string, { messageKey: MessageKey; labelKey: MessageKey; colorToken: string }>
> = {
  "state.notRunning": {
    messageKey: "projectGraph.surface.state.notRunning",
    labelKey: "projectGraph.surface.state.notRunning.label",
    colorToken: "--muted-foreground",
  },
  "state.noTraffic": {
    messageKey: "projectGraph.surface.state.noTraffic",
    labelKey: "projectGraph.surface.state.noTraffic.label",
    colorToken: "--muted-foreground",
  },
  "state.routeErrors": {
    messageKey: "projectGraph.surface.state.routeErrors",
    labelKey: "projectGraph.surface.state.routeErrors.label",
    colorToken: "--destructive",
  },
  "state.slowRoute": {
    messageKey: "projectGraph.surface.state.slowRoute",
    labelKey: "projectGraph.surface.state.slowRoute.label",
    colorToken: "--warning",
  },
  "state.noChanges": {
    messageKey: "projectGraph.surface.state.noChanges",
    labelKey: "projectGraph.surface.state.noChanges.label",
    colorToken: "--muted-foreground",
  },
  "state.fileModified": {
    messageKey: "projectGraph.surface.state.fileModified",
    labelKey: "projectGraph.surface.state.fileModified.label",
    colorToken: "--warning",
  },
  "state.fileAdded": {
    messageKey: "projectGraph.surface.state.fileAdded",
    labelKey: "projectGraph.surface.state.fileAdded.label",
    colorToken: "--success",
  },
  "state.fileDeleted": {
    messageKey: "projectGraph.surface.state.fileDeleted",
    labelKey: "projectGraph.surface.state.fileDeleted.label",
    colorToken: "--destructive",
  },
  "state.noRoles": {
    messageKey: "projectGraph.surface.state.noRoles",
    labelKey: "projectGraph.surface.state.noRoles.label",
    colorToken: "--muted-foreground",
  },
  "state.publicRoute": {
    messageKey: "projectGraph.surface.state.publicRoute",
    labelKey: "projectGraph.surface.state.publicRoute.label",
    colorToken: "--info",
  },
  "state.reachableRoute": {
    messageKey: "projectGraph.surface.state.reachableRoute",
    labelKey: "projectGraph.surface.state.reachableRoute.label",
    colorToken: "--success",
  },
  "state.undeclaredPermission": {
    messageKey: "projectGraph.surface.state.undeclaredPermission",
    labelKey: "projectGraph.surface.state.undeclaredPermission.label",
    colorToken: "--warning",
  },
  "state.wildcardRole": {
    messageKey: "projectGraph.surface.state.wildcardRole",
    labelKey: "projectGraph.surface.state.wildcardRole.label",
    colorToken: "--info",
  },
  "state.elevatedRoute": {
    messageKey: "projectGraph.surface.state.elevatedRoute",
    labelKey: "projectGraph.surface.state.elevatedRoute.label",
    colorToken: "--warning",
  },
  "state.noReach": {
    messageKey: "projectGraph.surface.state.noReach",
    labelKey: "projectGraph.surface.state.noReach.label",
    colorToken: "--muted-foreground",
  },
  "state.prerendered": {
    messageKey: "projectGraph.surface.state.prerendered",
    labelKey: "projectGraph.surface.state.prerendered.label",
    colorToken: "--success",
  },
  "state.prerenderEligible": {
    messageKey: "projectGraph.surface.state.prerenderEligible",
    labelKey: "projectGraph.surface.state.prerenderEligible.label",
    colorToken: "--info",
  },
  "state.privateApi": {
    messageKey: "projectGraph.surface.state.privateApi",
    labelKey: "projectGraph.surface.state.privateApi.label",
    colorToken: "--warning",
  },
  "state.authGuarded": {
    messageKey: "projectGraph.surface.state.authGuarded",
    labelKey: "projectGraph.surface.state.authGuarded.label",
    colorToken: "--warning",
  },
  "state.unknownSecurity": {
    messageKey: "projectGraph.surface.state.unknownSecurity",
    labelKey: "projectGraph.surface.state.unknownSecurity.label",
    colorToken: "--muted-foreground",
  },
  "state.dynamicPath": {
    messageKey: "projectGraph.surface.state.dynamicPath",
    labelKey: "projectGraph.surface.state.dynamicPath.label",
    colorToken: "--warning",
  },
  "state.redirect": {
    messageKey: "projectGraph.surface.state.redirect",
    labelKey: "projectGraph.surface.state.redirect.label",
    colorToken: "--warning",
  },
  "state.prerenderIneligible": {
    messageKey: "projectGraph.surface.state.prerenderIneligible",
    labelKey: "projectGraph.surface.state.prerenderIneligible.label",
    colorToken: "--warning",
  },
  "state.prerenderUnknown": {
    messageKey: "projectGraph.surface.state.prerenderUnknown",
    labelKey: "projectGraph.surface.state.prerenderUnknown.label",
    colorToken: "--muted-foreground",
  },
  "state.noPages": {
    messageKey: "projectGraph.surface.state.noPages",
    labelKey: "projectGraph.surface.state.noPages.label",
    colorToken: "--muted-foreground",
  },
};

function legendEntry(code: GraphLensCode): GraphLensLegendEntry {
  if (isStateCode(code)) {
    const entry = STATE_LEGEND[code];
    // A state code is registered here by the lens that declares it; a missing entry is a bug.
    if (entry === undefined) throw new Error("No legend entry for state code " + code);
    return { code, ...entry };
  }
  return {
    code,
    messageKey: DIAGNOSTIC_MESSAGE_KEYS[code],
    labelKey: DIAGNOSTIC_LABEL_KEYS[code],
    colorToken: DIAGNOSTIC_COLOR_TOKENS[code],
  };
}

export const GRAPH_LENSES: readonly GraphLensDefinition[] = GRAPH_LENS_IDS.map((id) => ({
  id,
  source: SOURCES[id],
  titleKey: TITLE_KEYS[id],
  shortKey: SHORT_KEYS[id],
  descriptionKey: DESCRIPTION_KEYS[id],
  colorToken: LENS_COLOR_TOKENS[id],
  codes: CODES_BY_LENS[id],
  legend: CODES_BY_LENS[id].map(legendEntry),
}));

export function lensDefinition(id: GraphLensId): GraphLensDefinition {
  const definition = GRAPH_LENSES.find((entry) => entry.id === id);
  // The ids are the literal union above, so the find can never miss.
  return definition ?? GRAPH_LENSES[0];
}

/** The one lens a code belongs to; null when the registry declares no lens for it. */
export function lensForCode(code: GraphLensCode): GraphLensId | null {
  return GRAPH_LENSES.find((definition) => definition.codes.includes(code))?.id ?? null;
}
