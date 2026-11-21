// Opening a graph card's source file (F.6: double-click keeps this affordance) and jumping to
// a line from the inspector's source preview. Extracted from ProjectGraphPanel for the 300-line
// source limit; both resolve the project-relative path before asking the controller to open it.

import { useCallback } from "react";
import type { IdeController } from "@/vv/controller";
import { sourcePathFor, type ProjectGraphNode } from "@/facilis/graph-model";

export function useProjectGraphOpen(c: IdeController, root: string | null) {
  const openNode = useCallback(
    (node: ProjectGraphNode) => {
      const path = sourcePathFor(root, node.sourceFile);
      if (path !== null) void c.openFile(path);
    },
    [c, root],
  );
  const openFileAt = useCallback(
    (file: string, line: number) => {
      const path = sourcePathFor(root, file);
      if (path !== null) void c.openFileAt(path, line);
    },
    [c, root],
  );
  return { openNode, openFileAt };
}
