// The layout footprint of each project-graph card kind (issue #60, epic #56 rule 2): the width
// of its Tailwind class (w-56/w-60/w-64 = 224/240/256 px) plus the height the FULL card's content
// settles at with the >= 10 px base text. These sizes are LOD-INVARIANT: chip and compact render
// inside the same footprint (the full content stays in the DOM as an invisible sizer), so React
// Flow's measured node size — and therefore every edge anchor — never moves when the level
// changes. The AI scene (graph-scene.ts) and the edge fallback share this single source so the
// screenshot and the canvas agree.

import type { GraphNodeKind } from "@facilis.dev/analyze";

export interface GraphNodeSize {
  readonly width: number;
  readonly height: number;
}

export const GRAPH_NODE_SIZES: Readonly<Record<GraphNodeKind, GraphNodeSize>> = {
  page: { width: 224, height: 160 },
  route: { width: 256, height: 64 },
  table: { width: 240, height: 88 },
  view: { width: 240, height: 88 },
  workflow: { width: 256, height: 72 },
};
