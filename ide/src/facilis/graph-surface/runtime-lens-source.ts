// The live source adapter of the runtime lens (D-225 §4, Q18). It is the one place that
// turns a lens opening into the D-200 enable/disable calls, so the dev handle and the lens
// use the same seam and cannot drift. Unavailable is a code: a stopped preview never posts
// an enable message.

import type { KernelBridge } from "@/vv/kernel";
import { getRuntimeMetrics, subscribeRuntimeMetrics } from "../runtime-metrics";
import {
  disableRuntimeMetrics,
  enableRuntimeMetrics,
  runtimeMetricsSession,
  type RuntimeMetricsPreview,
} from "../runtime-metrics-wire";
import {
  LENS_AVAILABLE,
  type GraphLensAvailability,
  type GraphLensSourceAdapter,
} from "./lens-lifecycle.ts";
import { buildRuntimeLensState, runtimeRouteTemplates } from "./runtime-lens.ts";

/** The controller slice the runtime lens needs (the same one the dev handle uses). */
export interface RuntimeLensController {
  readonly bridge: KernelBridge;
  readonly preview: RuntimeMetricsPreview;
}

/** The same availability the lifecycle asks for, shared with the palette and the picker. */
export function runtimeLensAvailability(
  controller: RuntimeLensController,
  dev: boolean = import.meta.env.DEV,
): GraphLensAvailability {
  if (!dev) {
    return { available: false, reasonKey: "projectGraph.surface.state.devOnly" };
  }
  if (controller.preview.activePreviewTab() === null) {
    return { available: false, reasonKey: "projectGraph.surface.state.notRunning" };
  }
  if (runtimeMetricsSession(controller.bridge, controller.preview) === null) {
    return { available: false, reasonKey: "projectGraph.surface.state.notRunning" };
  }
  return LENS_AVAILABLE;
}

export function createRuntimeLensSource(
  controller: RuntimeLensController,
  dev: boolean = import.meta.env.DEV,
): GraphLensSourceAdapter {
  const availability = (): GraphLensAvailability => runtimeLensAvailability(controller, dev);
  return {
    source: "live",
    availability,
    activate(_lens, context) {
      if (!availability().available) return;
      const session = runtimeMetricsSession(controller.bridge, controller.preview);
      if (session === null) return;
      enableRuntimeMetrics(session, runtimeRouteTemplates(context.view));
    },
    deactivate() {
      disableRuntimeMetrics();
    },
    state(_lens, context) {
      return buildRuntimeLensState(getRuntimeMetrics().snapshot(), context.view);
    },
    subscribe(listener) {
      return subscribeRuntimeMetrics(listener);
    },
  };
}
