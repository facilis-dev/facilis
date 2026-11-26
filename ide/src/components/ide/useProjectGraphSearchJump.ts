// Search-jump resolution for the project graph (D-219, issue #187): the debounced match set
// plus the pure first-match/domain rule, exposed as a jump request the surface centres on.
// Kept out of the panel so the panel stays under the line limit.

import { useCallback, useMemo, useState } from "react";
import { deriveDomains, domainIndex } from "@/facilis/graph-surface/domains.ts";
import { normalizeGraphQuery } from "@/facilis/graph-search";
import { firstGraphSearchJump } from "@/facilis/graph-search-jump";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import type { GraphSearchResult } from "@/facilis/graph-view-model";
import type { GraphJumpRequest } from "./ProjectGraphSurface";

export interface ProjectGraphSearchJump {
  readonly searchResults: readonly ProjectGraphNode[];
  readonly jump: GraphJumpRequest | null;
  readonly jumpToNode: (nodeId: string) => void;
  readonly submitSearch: () => void;
}

export function useProjectGraphSearchJump({
  view,
  groups,
  query,
  search,
  flushSearch,
  onJump,
}: {
  view: ProjectGraphView | null;
  /** Per-node feature-group overrides, so a jump opens the group the user pinned. */
  groups: Readonly<Record<string, string>>;
  query: string;
  search: GraphSearchResult;
  flushSearch: () => GraphSearchResult;
  onJump: (nodeId: string, domain: string) => void;
}): ProjectGraphSearchJump {
  const [jump, setJump] = useState<GraphJumpRequest | null>(null);
  const domainOf = useMemo(
    () => domainIndex(deriveDomains(view?.nodes ?? [], view?.edges ?? [], groups)),
    [view, groups],
  );
  // A pending keystroke yields an empty list instead of the previous (stale) match set.
  const searchResults = useMemo(() => {
    if (view === null || query.trim().length === 0) return [];
    if (normalizeGraphQuery(query) !== search.query) return [];
    return view.nodes.filter((node) => search.matched.has(node.id)).slice(0, 8);
  }, [view, query, search]);
  const jumpToNode = useCallback(
    (nodeId: string) => {
      const domain = domainOf.get(nodeId);
      if (domain === undefined) return;
      onJump(nodeId, domain);
      setJump((previous) => ({ nodeId, nonce: (previous?.nonce ?? 0) + 1 }));
    },
    [domainOf, onJump],
  );
  const submitSearch = useCallback(() => {
    if (view === null || query.trim().length === 0) return;
    const result = flushSearch();
    const target = firstGraphSearchJump(view.nodes, result.matched, domainOf);
    if (target !== null) jumpToNode(target.nodeId);
  }, [view, query, flushSearch, domainOf, jumpToNode]);
  return { searchResults, jump, jumpToNode, submitSearch };
}
