// The canvas keyboard camera (issue #213): pan and zoom are pointer-only today, so a focused
// canvas answers the arrows, the zoom keys and fit. Everything goes through the same pure camera
// transforms the gesture pipeline uses, and every change marks the frame dirty and persists the
// viewport on the same debounce as the wheel, so a keyboard pan survives a reload like a drag.

import { useCallback, type KeyboardEvent, type RefObject } from "react";
import {
  cameraAfterKeyboard,
  surfaceKeyboardAction,
} from "@/facilis/graph-surface/surface-keyboard.ts";
import type { SurfaceCamera } from "@/facilis/graph-surface/camera.ts";
import type { SurfaceSize } from "./use-graph-surface-camera";

export function useGraphSurfaceKeyboard({
  cameraRef,
  sizeRef,
  dirtyRef,
  fitNow,
  scheduleViewportPersist,
}: {
  cameraRef: RefObject<SurfaceCamera>;
  sizeRef: RefObject<SurfaceSize>;
  dirtyRef: RefObject<boolean>;
  fitNow: () => void;
  scheduleViewportPersist: () => void;
}): { onKeyDown: (event: KeyboardEvent<HTMLCanvasElement>) => void } {
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLCanvasElement>) => {
      const action = surfaceKeyboardAction(event);
      if (action === null) return;
      event.preventDefault();
      if (action === "fit") {
        fitNow();
        return;
      }
      const size = sizeRef.current;
      cameraRef.current = cameraAfterKeyboard(action, cameraRef.current, size.width, size.height);
      dirtyRef.current = true;
      scheduleViewportPersist();
    },
    [cameraRef, sizeRef, dirtyRef, fitNow, scheduleViewportPersist],
  );
  return { onKeyDown };
}
