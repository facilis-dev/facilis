// The surface camera lifecycle (D-211, issue #185, D-127): restore the session/saved camera on
// open and on mode changes instead of silently re-fitting, fit only on the explicit Fit button,
// and persist the overview camera to the git-ignored viewport.json on gesture end. Pan/zoom stay
// pure camera transforms — this hook never touches node positions or re-runs layout.

import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { GraphViewport } from "@/facilis/graph-layout";
import {
  SURFACE_MIN_FIT_SCALE,
  centerCameraOn,
  fitCamera,
  panCameraForInsets,
  restoreCamera,
  viewportFromCamera,
  type SurfaceCamera,
} from "@/facilis/graph-surface/camera.ts";
import type { SurfaceRect } from "@/facilis/graph-surface/layout.ts";
import type { SurfaceScene } from "@/facilis/graph-surface/scene.ts";
import { drawerInsets, type SurfaceInsets } from "@/facilis/graph-surface/safe-area.ts";
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
  drawerOpen,
  sheet,
  selectedNodeId,
  onViewportChange,
}: {
  sceneRef: RefObject<SurfaceScene | null>;
  sizeRef: RefObject<SurfaceSize>;
  dirtyRef: RefObject<boolean>;
  modeKey: string;
  fitNonce: number;
  viewport: GraphViewport | undefined;
  /** The floating drawer's state: fit reserves its footprint and toggling it pans the camera. */
  drawerOpen: boolean;
  /** Narrow viewport: the drawer is a bottom sheet and fit/centre reserve its height. */
  sheet: boolean;
  /** Opening the sheet with a selection centres that node above it (#191). */
  selectedNodeId: string | null;
  onViewportChange: (viewport: GraphViewport) => void;
}) {
  const cameraRef = useRef<SurfaceCamera>({ tx: 0, ty: 0, scale: 1 });
  const sessionRef = useRef(new Map<string, SurfaceCamera>());
  // Latest-ref pattern: effects read the current mode/saved viewport without re-subscribing.
  const savedRef = useRef(viewport);
  savedRef.current = viewport;
  const modeKeyRef = useRef(modeKey);
  modeKeyRef.current = modeKey;
  const drawerOpenRef = useRef(drawerOpen);
  drawerOpenRef.current = drawerOpen;
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The insets the current camera was fitted/restored with: the drawer-pan delta baseline. */
  const insetRef = useRef<SurfaceInsets>({ top: 0, right: 0, bottom: 0 });
  const previousModeRef = useRef(modeKey);

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
    const insets = drawerInsets(sheetRef.current, size.height, drawerOpenRef.current);
    const camera = fitCamera(current.layout.bounds, size.width, size.height, {
      insetTop: insets.top,
      insetRight: insets.right,
      insetBottom: insets.bottom,
      maxScale: 1.1,
    });
    cameraRef.current = camera;
    insetRef.current = insets;
    sessionRef.current.set(modeKeyRef.current, camera);
    dirtyRef.current = true;
    persist();
  }, [sceneRef, sizeRef, dirtyRef, persist]);

  const restoreOrFit = useCallback(() => {
    const current = sceneRef.current;
    const size = sizeRef.current;
    if (current === null || size.width === 0 || size.height === 0) return;
    const insets = drawerInsets(sheetRef.current, size.height, drawerOpenRef.current);
    const camera = restoreCamera({
      session: sessionRef.current.get(modeKeyRef.current),
      saved: modeKeyRef.current === "overview" ? savedRef.current : undefined,
      bounds: current.layout.bounds,
      width: size.width,
      height: size.height,
      insetTop: insets.top,
      insetRight: insets.right,
      insetBottom: insets.bottom,
    });
    cameraRef.current = camera;
    insetRef.current = insets;
    sessionRef.current.set(modeKeyRef.current, camera);
    dirtyRef.current = true;
  }, [sceneRef, sizeRef, dirtyRef]);

  // A mode change restores that mode's camera; it never silently re-fits (D-127).
  useEffect(() => {
    restoreOrFit();
  }, [modeKey, restoreOrFit]);

  // Opening/closing the drawer changes the reserved area: pan by half the delta so the free
  // area stays centred on the same world point, and never touch the scale (#187/#191).
  useEffect(() => {
    const next = drawerInsets(sheetRef.current, sizeRef.current.height, drawerOpen);
    const sameMode = previousModeRef.current === modeKey;
    previousModeRef.current = modeKey;
    if (!sameMode) {
      // The mode effect already fitted/restored with the new inset: this is only the baseline.
      insetRef.current = next;
      return;
    }
    const previous = insetRef.current;
    if (previous.right === next.right && previous.bottom === next.bottom) return;
    cameraRef.current = panCameraForInsets(cameraRef.current, previous, next);
    insetRef.current = next;
    sessionRef.current.set(modeKeyRef.current, cameraRef.current);
    dirtyRef.current = true;
    persist();
  }, [drawerOpen, modeKey, persist]);

  /**
   * Bring a world rect into the middle of the free area at a readable scale (search/jump/selection).
   * The drawer inset is read live so the target lands left of the side column or above the sheet.
   */
  const centerOn = useCallback(
    (rect: SurfaceRect) => {
      const size = sizeRef.current;
      if (size.width === 0 || size.height === 0) return;
      const current = sceneRef.current;
      if (current === null) return;
      const insets = drawerInsets(sheetRef.current, size.height, drawerOpenRef.current);
      const camera = centerCameraOn(
        rect,
        size.width,
        size.height,
        Math.max(SURFACE_MIN_FIT_SCALE, Math.min(1.1, cameraRef.current.scale)),
        { insetTop: insets.top, insetRight: insets.right, insetBottom: insets.bottom },
      );
      cameraRef.current = camera;
      insetRef.current = insets;
      sessionRef.current.set(modeKeyRef.current, camera);
      dirtyRef.current = true;
      persist();
    },
    [sceneRef, sizeRef, dirtyRef, persist],
  );

  // A tap selects and opens the bottom sheet; centre the node in the free area ABOVE the sheet
  // so the inspector never hides what was just selected (the old #144/#155 bug, #191).
  useEffect(() => {
    if (!sheet || !drawerOpen || selectedNodeId === null) return;
    const current = sceneRef.current;
    if (current === null || current.mode !== "detail") return;
    const rect = current.layout.positions.get(selectedNodeId);
    if (rect !== undefined) centerOn(rect);
  }, [centerOn, drawerOpen, sceneRef, selectedNodeId, sheet]);

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

  return { cameraRef, fitNow, restoreOrFit, centerOn, noteGestureEnd, scheduleViewportPersist };
}
