// Writes the live viewport zoom as the --graph-lod-zoom CSS variable on the canvas wrapper
// (issue #60). Chip and compact sizes divide by it, so their SCREEN size stays constant while
// zooming — without a React re-render per frame: this component subscribes to the store outside
// React's render cycle and only touches a style property. The quantised useGraphLod selector
// decides WHAT is drawn; this variable only scales the counter-scaled sizes inside it.

import { useEffect, type RefObject } from "react";
import { useStoreApi } from "@xyflow/react";
import { GRAPH_LOD_ZOOM_VAR } from "@/facilis/graph-lod";

export function ProjectGraphZoomVar({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const store = useStoreApi();
  useEffect(() => {
    let last = Number.NaN;
    const apply = (zoom: number) => {
      if (zoom === last) return;
      last = zoom;
      target.current?.style.setProperty(GRAPH_LOD_ZOOM_VAR, String(zoom));
    };
    apply(store.getState().transform[2]);
    return store.subscribe((state) => apply(state.transform[2]));
  }, [store, target]);
  return null;
}
