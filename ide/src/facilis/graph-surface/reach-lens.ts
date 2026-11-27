// The reach lens's facts (D-225, Q20): what one declared role can call. Pure and read-only:
// the matching rule is the framework's (hasPermission requires at least one of the route's
// permissions; a "*" role grants every declared permission), and the page/table surface is the
// route's one-hop neighbourhood, so the lens reuses the focus traversal instead of a new walk.

import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphView } from "../graph-model";
import { deriveDomains, domainIndex } from "./domains.ts";
import { buildNeighborIndex, focusNeighborhood } from "./focus.ts";
import type { GraphLensPicker, GraphLensState, GraphStateFact } from "./state-facts.ts";

/** The declared config facts the lens reads; ConfigFacts satisfies this structurally. */
export interface ReachConfig {
  readonly roles: Readonly<Record<string, readonly string[]>>;
  readonly permissions: readonly string[];
  readonly defaultRole: string | null;
}

const WILDCARD = "*";

interface Held {
  readonly permissions: ReadonlySet<string>;
  readonly wildcard: boolean;
}

/** The framework's expandRoles: declared order, "*" expands to every declared permission. */
function heldBy(config: ReachConfig, role: string): Held {
  const permissions = new Set<string>();
  let wildcard = false;
  for (const permission of config.roles[role] ?? []) {
    if (permission === WILDCARD) {
      wildcard = true;
      for (const granted of config.permissions) permissions.add(granted);
    } else {
      permissions.add(permission);
    }
  }
  return { permissions, wildcard };
}

/**
 * The framework's hasPermission: [] is public, otherwise at least one declared permission.
 * expandRoles already turned "*" into the declared permissions, so a route asking for an
 * undeclared permission is not reachable even through a wildcard role.
 */
function canReach(required: readonly string[], held: Held): boolean {
  return required.length === 0 || required.some((p) => held.permissions.has(p));
}

/** The role the picker starts on: the config's default when it still exists, else the first. */
export function defaultReachRole(config: ReachConfig): string | null {
  const roles = Object.keys(config.roles);
  if (config.defaultRole !== null && roles.includes(config.defaultRole)) return config.defaultRole;
  return roles[0] ?? null;
}

/** Every permission at least one declared role holds, for the undeclared-permission test. */
function heldByAnyRole(config: ReachConfig): Held {
  const permissions = new Set<string>();
  let wildcard = false;
  for (const role of Object.keys(config.roles)) {
    const held = heldBy(config, role);
    wildcard = wildcard || held.wildcard;
    for (const permission of held.permissions) permissions.add(permission);
  }
  return { permissions, wildcard };
}

const BADGE_KEYS = {
  public: "projectGraph.surface.state.publicRoute.short",
  elevated: "projectGraph.surface.state.elevatedRoute.short",
  undeclared: "projectGraph.surface.state.undeclaredPermission.short",
} as const satisfies Record<string, MessageKey>;

const BADGE_TOKENS = {
  public: "--info",
  elevated: "--warning",
  undeclared: "--warning",
} as const;

function badge(kind: keyof typeof BADGE_KEYS): { text: string; colorToken: string } {
  return { text: t(BADGE_KEYS[kind]), colorToken: BADGE_TOKENS[kind] };
}

function pickerFor(
  config: ReachConfig,
  selected: string,
  onSelect: (role: string) => void,
): GraphLensPicker {
  return {
    labelKey: "projectGraph.surface.state.reach.role",
    value: selected,
    options: Object.keys(config.roles),
    onSelect,
  };
}

function baseState(
  config: ReachConfig | null,
  selected: string | null,
  onSelect: (role: string) => void,
  emptyKey: MessageKey,
  emptyHintKey: MessageKey,
): GraphLensState {
  return {
    facts: [],
    totals: null,
    params: {},
    contextKey: null,
    emptyKey,
    emptyHintKey,
    badges: new Map(),
    ...(config === null || selected === null
      ? {}
      : { picker: pickerFor(config, selected, onSelect) }),
  };
}

/** Map the declared config facts onto the drawn graph for the selected role. */
export function buildReachLensState(
  config: ReachConfig | null,
  view: ProjectGraphView | null,
  role: string | null,
  onSelect: (role: string) => void,
): GraphLensState {
  const declared: ReachConfig = config ?? { roles: {}, permissions: [], defaultRole: null };
  const selected =
    role !== null && declared.roles[role] !== undefined ? role : defaultReachRole(declared);
  if (config === null || selected === null) {
    return baseState(
      config,
      selected,
      onSelect,
      "projectGraph.surface.state.noRoles",
      "projectGraph.surface.state.reach.emptyHint",
    );
  }
  if (view === null) {
    return baseState(
      config,
      selected,
      onSelect,
      "projectGraph.surface.state.noReach",
      "projectGraph.surface.state.reach.emptyHint",
    );
  }
  const held = heldBy(config, selected);
  const anyRole = heldByAnyRole(config);
  const byId = new Map(view.nodes.map((node) => [node.id, node] as const));
  const neighbors = buildNeighborIndex(view.edges);
  const facts: GraphStateFact[] = [];
  const badges = new Map<string, { text: string; colorToken: string }>();
  const highlight = new Set<string>();
  const pages = new Set<string>();
  const tables = new Set<string>();
  let routes = 0;
  for (const node of view.nodes) {
    if (node.data.kind !== "route") continue;
    const permission = node.data.permission;
    const reachable = canReach(permission, held);
    if (!reachable) {
      const undeclared = permission.filter((entry) => !anyRole.permissions.has(entry));
      if (undeclared.length > 0) {
        facts.push({
          nodeId: node.id,
          code: "state.undeclaredPermission",
          params: {
            method: node.data.method,
            path: node.data.path,
            permission: undeclared.join(", "),
          },
        });
        badges.set(node.id, badge("undeclared"));
        highlight.add(node.id);
      }
      continue;
    }
    routes += 1;
    highlight.add(node.id);
    if (permission.length === 0) {
      facts.push({
        nodeId: node.id,
        code: "state.publicRoute",
        params: { method: node.data.method, path: node.data.path },
      });
    } else {
      facts.push({
        nodeId: node.id,
        code: "state.reachableRoute",
        params: {
          method: node.data.method,
          path: node.data.path,
          permission: permission.join(", "),
        },
      });
    }
    if (node.data.elevations.length > 0) {
      facts.push({
        nodeId: node.id,
        code: "state.elevatedRoute",
        params: { method: node.data.method, path: node.data.path },
      });
      badges.set(node.id, badge("elevated"));
    } else if (permission.length === 0) {
      badges.set(node.id, badge("public"));
    }
    for (const adjacent of focusNeighborhood(neighbors, node.id, 1)) {
      if (adjacent === node.id) continue;
      const target = byId.get(adjacent);
      if (target?.kind === "page") {
        pages.add(adjacent);
        highlight.add(adjacent);
      } else if (target?.kind === "table" || target?.kind === "view") {
        tables.add(adjacent);
        highlight.add(adjacent);
      }
    }
  }
  const contextKey: MessageKey = held.wildcard
    ? "projectGraph.surface.state.wildcardRole"
    : "projectGraph.surface.state.reach.context";
  return {
    facts,
    totals: {
      key: "projectGraph.surface.state.reach.totals",
      count: routes,
      params: { pages: pages.size, tables: tables.size },
    },
    params: { role: selected },
    contextKey,
    emptyKey: routes === 0 && facts.length === 0 ? "projectGraph.surface.state.noReach" : null,
    emptyHintKey:
      routes === 0 && facts.length === 0 ? "projectGraph.surface.state.reach.emptyHint" : null,
    badges,
    highlight: [...highlight],
    picker: pickerFor(config, selected, onSelect),
    groups: domainIndex(deriveDomains(view.nodes, view.edges)),
  };
}
