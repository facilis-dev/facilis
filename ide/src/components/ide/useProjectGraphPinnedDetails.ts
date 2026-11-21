// The pinned details cards' session state (issue #59), extracted from ProjectGraphPanel so the
// composition root stays under the 300-line source limit now that navigation landed. Pinned
// cards are session-only: they are pruned when the analysis no longer draws a node and are
// never persisted, so the saved layout learns nothing about them (epic #56 rule 2).

import { useEffect, useReducer, useState, type Dispatch } from "react";
import {
  INITIAL_PINNED_DETAILS,
  SHEET_DEFAULT_HEIGHT,
  pinnedDetailsReducer,
  type PinnedDetailsAction,
  type PinnedDetailsCard,
} from "@/facilis/graph-satellite";
import type { PinRequest } from "./useProjectGraphDetails";

export interface ProjectGraphPinnedDetails {
  readonly pinned: readonly PinnedDetailsCard[];
  readonly dispatchPinned: Dispatch<PinnedDetailsAction>;
  readonly pinnedIds: readonly string[];
  readonly pinRequest: PinRequest | null;
  readonly requestPin: (nodeId: string) => void;
  readonly sheetHeight: number;
  readonly setSheetHeight: (height: number) => void;
}

/** A fresh pin request each time: the canvas reveals the card once per nonce, not per render. */
export function useProjectGraphPinnedDetails(
  knownNodeIds: ReadonlySet<string> | null,
): ProjectGraphPinnedDetails {
  const [pinned, dispatchPinned] = useReducer(pinnedDetailsReducer, INITIAL_PINNED_DETAILS);
  const [pinRequest, setPinRequest] = useState<PinRequest | null>(null);
  const [sheetHeight, setSheetHeight] = useState(SHEET_DEFAULT_HEIGHT);
  useEffect(() => {
    if (knownNodeIds !== null) dispatchPinned({ type: "prune", knownNodeIds });
  }, [knownNodeIds]);
  const requestPin = (nodeId: string) =>
    setPinRequest((current) => ({ nonce: (current?.nonce ?? 0) + 1, nodeId }));
  return {
    pinned,
    dispatchPinned,
    pinnedIds: pinned.map((card) => card.nodeId),
    pinRequest,
    requestPin,
    sheetHeight,
    setSheetHeight,
  };
}
