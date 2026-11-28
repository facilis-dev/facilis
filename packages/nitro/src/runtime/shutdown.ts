// The framework runtime's shutdown seam (issue #162).
//
// The full-stack prerender pass imports the built Nitro server IN-PROCESS (D-202), so the
// boot's background tickers (jobs queue, workflow runner) and the PGlite cluster live in the
// build process itself. srvx's server.close() runs nitro's "close" hooks; registering here is
// what makes that close stop the tickers and the cluster — without it `vite build` prints
// success and never exits. A production node-server SIGTERM reaches the same hook.
import { useNitroHooks } from "nitro/app";
import type { FacilisDb } from "@facilis.dev/db";

import type { DevDbSnapshotter } from "./dev-db-persistence.ts";
import type { JobsRuntime } from "./jobs/runtime.ts";
import type { WorkflowsRuntime } from "./workflows/runner.ts";

export interface RuntimeShutdownDeps {
  readonly db: FacilisDb | null;
  readonly jobs: JobsRuntime | null;
  readonly workflows: WorkflowsRuntime | null;
  readonly snapshotter: DevDbSnapshotter | null;
}

/** The slice of nitro's hookable this module needs; injectable so tests need no nitro app. */
export interface CloseHookTarget {
  hook(name: "close", fn: () => Promise<void>): void;
}

/**
 * The runtime this process booted. It lives on `globalThis` because a Vite full reload
 * re-evaluates the module graph: a module-scoped handle is lost, and the previous boot's
 * PGlite cluster and dev snapshotter keep running beside the new one (their timers write the
 * same snapshot file). The symbol survives the re-evaluation.
 */
const RUNTIME_KEY: unique symbol = Symbol.for("facilis.processRuntime");
type RuntimeDisposer = () => Promise<void>;
const runtimeRegistry = globalThis as unknown as Record<symbol, RuntimeDisposer | undefined>;

/** Tear down the runtime a previous module evaluation registered, if any. */
export async function disposePreviousRuntime(): Promise<void> {
  const dispose = runtimeRegistry[RUNTIME_KEY];
  if (dispose === undefined) return;
  runtimeRegistry[RUNTIME_KEY] = undefined;
  await dispose();
}

export function registerRuntimeCloseHook(
  deps: RuntimeShutdownDeps,
  hooks: CloseHookTarget = useNitroHooks(),
): void {
  let closed = false;
  const dispose = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (runtimeRegistry[RUNTIME_KEY] === dispose) runtimeRegistry[RUNTIME_KEY] = undefined;
    await shutdownRuntimes(deps);
  };
  runtimeRegistry[RUNTIME_KEY] = dispose;
  hooks.hook("close", dispose);
}

/**
 * Stop the tickers before the final snapshot flush, and close the cluster even when a stop
 * fails: PGlite's wasm timer only dies with the cluster, so a skipped close is the hang.
 * Every step runs; the collected failures surface once the process is releasable.
 */
export async function shutdownRuntimes(deps: RuntimeShutdownDeps): Promise<void> {
  const failures: unknown[] = [];
  const attempt = async (step: () => Promise<void> | void): Promise<void> => {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  };
  await attempt(() => deps.jobs?.stop());
  await attempt(() => deps.workflows?.stop());
  deps.snapshotter?.stop();
  await attempt(() => deps.snapshotter?.flush());
  await attempt(() => deps.db?.close());
  if (failures.length > 0) {
    throw new AggregateError(failures, "[facilis] runtime shutdown failed");
  }
}
