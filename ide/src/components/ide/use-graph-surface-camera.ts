// The surface camera lifecycle (D-211, issue #185, D-127): restore the session/saved camera on
// open and on mode changes instead of silently re-fitting, fit only on the explicit Fit button,
// and persist the overview camera to the git-ignored viewport.json on gesture end. Pan/zoom stay
// pure camera transforms — this hook never touches node positions or re-runs layout.

import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { GraphViewport } from "@/facilis/graph-layout";
import {
  fitCamera,
  restoreCamera,
  viewportFromCamera,
  type SurfaceCamera,
} from "@/facilis/graph-surface/camera.ts";
import type { SurfaceScene } from "@/facilis/graph-surface/scene.ts";

/** The inspector is a w-80 (320px) side panel: fit reserves its width so cards never hide under it. */
const INSPECTOR_WIDTH = 320;
/** Wheel zoom has no "up" event: persist a short debounce after the last scroll. */
const WHEEL_SAVE_DELAY_MS = 300;

export interface SurfaceSize {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export function useGraphSurfaceCamera({
  sceneRef,
  sizeRef,
  dirtyRef,
  modeKey,
  fitNonce,
  viewport,
  onViewportChange,
}: {
  sceneRef: RefObject<SurfaceScene | null>;
  sizeRef: RefObject<SurfaceSize>;
  dirtyRef: RefObject<boolean>;
  modeKey: string;
  fitNonce: number;
  viewport: GraphViewport | undefined;
  onViewportChange: (viewport: GraphViewport) => void;
}) {
  const cameraRef = useRef<SurfaceCamera>({ tx: 0, ty: 0, scale: 1 });
  const sessionRef = useRef(new Map<string, SurfaceCamera>());
  // Latest-ref pattern: effects read the current mode/saved viewport without re-subscribing.
  const savedRef = useRef(viewport);
  savedRef.current = viewport;
  const modeKeyRef = useRef(modeKey);
  modeKeyRef.current = modeKey;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only the overview camera is the project's saved viewport; detail cameras are session-only,
  // so a detail pan cannot leak a foreign world-space into the overview's next open.
  const persist = useCallback(() => {
    if (modeKeyRef.current !== "overview") return;
    onViewportChange(viewportFromCamera(cameraRef.current));
  }, [onViewportChange]);

  const fitNow = useCallback(() => {
    const current = sceneRef.current;
    const size = sizeRef.current;
    if (current === null || size.width === 0 || size.height === 0) return;
    const insetRight = current.mode === "detail" ? INSPECTOR_WIDTH : 0;
    const camera = fitCamera(current.layout.bounds, size.width, size.height, {
      insetRight,
      maxScale: 1.1,
    });
    cameraRef.current = camera;
    sessionRef.current.set(modeKeyRef.current, camera);
    dirtyRef.current = true;
    persist();
  }, [sceneRef, sizeRef, dirtyRef, persist]);

  const restoreOrFit = useCallback(() => {
    const current = sceneRef.current;
    const size = sizeRef.current;
    if (current === null || size.width === 0 || size.height === 0) return;
    const insetRight = current.mode === "detail" ? INSPECTOR_WIDTH : 0;
    const camera = restoreCamera({
      session: sessionRef.current.get(modeKeyRef.current),
      saved: modeKeyRef.current === "overview" ? savedRef.current : undefined,
      bounds: current.layout.bounds,
      width: size.width,
      height: size.height,
      insetRight,
    });
    cameraRef.current = camera;
    sessionRef.current.set(modeKeyRef.current, camera);
    dirtyRef.current = true;
  }, [sceneRef, sizeRef, dirtyRef]);

  // A mode change restores that mode's camera; it never silently re-fits (D-127).
  useEffect(() => {
    restoreOrFit();
  }, [modeKey, restoreOrFit]);

  // The Fit button (fitNonce) is the only explicit re-fit.
  const lastNonce = useRef(fitNonce);
  useEffect(() => {
    if (fitNonce === lastNonce.current) return;
    lastNonce.current = fitNonce;
    fitNow();
  }, [fitNonce, fitNow]);

  const noteGestureEnd = useCallback(() => {
    sessionRef.current.set(modeKeyRef.current, cameraRef.current);
    persist();
  }, [persist]);

  const scheduleViewportPersist = useCallback(() => {
    sessionRef.current.set(modeKeyRef.current, cameraRef.current);
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      persist();
    }, WHEEL_SAVE_DELAY_MS);
  }, [persist]);

  useEffect(
    () => () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    },
    [],
  );

  return { cameraRef, fitNow, restoreOrFit, noteGestureEnd, scheduleViewportPersist };
}
