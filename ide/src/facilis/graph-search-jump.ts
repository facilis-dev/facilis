// Search jump resolution (D-211, issue #187): the first debounced match plus the domain its
// node belongs to. The panel turns this into `mode=detail`, a selection and a camera request;
// keeping the resolution pure makes the "drill to the node's domain" rule testable.

import type { ProjectGraphNode } from "./graph-types.ts";

export interface GraphSearchJump {
  readonly nodeId: string;
  readonly domain: string;
}

/** The first matching node in model order that has a domain; null when nothing matches. */
export function firstGraphSearchJump(
  nodes: readonly ProjectGraphNode[],
  matched: ReadonlySet<string>,
  domainOf: ReadonlyMap<string, string>,
): GraphSearchJump | null {
  for (const node of nodes) {
    if (!matched.has(node.id)) continue;
    const domain = domainOf.get(node.id);
    if (domain !== undefined) return { nodeId: node.id, domain };
  }
  return null;
}
