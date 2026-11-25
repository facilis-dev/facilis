// The panel's incremental graph view-model (issue #186): a thin React adapter over the pure
// graph-view-model controller. The model rebuilds only when the analysis or the saved layout
// inputs change; the toolbar's raw keystrokes go straight to the controller's debounce, and the
// debounced match result is published as draw state for the canvas. Selection and focus never
// enter this hook — they stay surface draw state.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ProjectGraph } from "@facilis.dev/analyze";
import type { GraphLayoutFile } from "@/facilis/graph-layout";
import type { ProjectGraphView } from "@/facilis/graph-model";
import {
  createGraphViewModel,
  graphViewModelInput,
  type GraphSearchResult,
  type GraphViewModel,
} from "@/facilis/graph-view-model";

export interface ProjectGraphViewModel {
  readonly view: ProjectGraphView | null;
  /** The toolbar input's immediate value (uncontrolled by the debounce). */
  readonly query: string;
  /** The debounced match pass result: dims cards, never rebuilds the model. */
  readonly search: GraphSearchResult;
  readonly onQueryChange: (value: string) => void;
  /** Enter: run the pending debounce now and return the match set immediately. */
  readonly flushSearch: () => GraphSearchResult;
}

export function useProjectGraphViewModel(
  graph: ProjectGraph | null,
  layout: GraphLayoutFile,
): ProjectGraphViewModel {
  const [query, setQuery] = useState("");
  // The debounced pass fires outside render: bump to publish the controller's new draw state.
  const [, bump] = useReducer((count: number) => count + 1, 0);
  const modelRef = useRef<GraphViewModel | null>(null);
  if (modelRef.current === null) {
    modelRef.current = createGraphViewModel({ onSearch: bump });
  }
  const model = modelRef.current;
  useEffect(() => () => model.dispose(), [model]);
  // Memoized inside the controller by dataset + saved layout inputs only: a selection, focus,
  // viewport or search change returns the cached model without rebuilding node objects.
  const view = model.update(graphViewModelInput(graph, layout));
  const onQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      model.pushQuery(value);
    },
    [model],
  );
  const flushSearch = useCallback(() => {
    model.flush();
    return model.searchResult;
  }, [model]);
  return { view, query, search: model.searchResult, onQueryChange, flushSearch };
}
