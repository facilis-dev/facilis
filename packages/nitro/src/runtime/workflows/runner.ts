// The workflow runner (D-135, docs/WORKFLOWS.md §8): a tick, not a job.
//
// The tick scans active rows and applies one transition each; a start or a decision only
// wakes it. Nothing here waits for a human or keeps a transaction open across steps, which is
// what makes an approval survive the dev-server worker reload (WORKFLOWS.md §2).
import type { WorkflowsApi } from "@facilis.dev/core";

import type { JobTimers } from "../jobs/contracts.ts";
import { SYSTEM_TIMERS } from "../jobs/engine-support.ts";
import type { WorkflowRuntimeDeps } from "./contracts.ts";
import { createWorkflowsApi } from "./runtime.ts";
import { expireDueTasks, stepWorkflow, TICK_BATCH } from "./transitions.ts";

/** The booted workflow runtime carried by BootstrapState (D-135). */
export interface WorkflowsRuntime {
  readonly api: WorkflowsApi;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** One tick; exposed for boot recovery and deterministic tests. */
  tick(): Promise<void>;
}

/**
 * Builds the runner around the shared deps: the API reads/writes rows, the tick advances
 * chains, and the job engine is only used for step dispatch, status and cancellation.
 */
export function createWorkflowRunner(deps: WorkflowRuntimeDeps): WorkflowsRuntime {
  const timers: JobTimers = deps.timers ?? SYSTEM_TIMERS;
  const now = (): Date => new Date(timers.now());
  const report = (error: unknown, context: string): void => deps.onError?.(error, context);

  let started = false;
  let stopping = false;
  let tickRunning = false;
  let wakeRequested = false;
  let timer: unknown = null;

  function scheduleTick(delayMs: number): void {
    if (!started || stopping) return;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      void tick().catch(() => undefined);
    }, delayMs);
  }

  /** A start/decision asks for an immediate tick; a running tick defers to it. */
  function requestTick(): void {
    if (!started || stopping) return;
    if (tickRunning) {
      wakeRequested = true;
      return;
    }
    scheduleTick(0);
  }

  async function tick(): Promise<void> {
    if (stopping || tickRunning) return;
    tickRunning = true;
    try {
      await expireDueTasks(deps, now);
      const active = await deps.store.list({ status: ["running", "waiting"], limit: TICK_BATCH });
      for (const workflow of active) {
        try {
          await stepWorkflow(deps, now, workflow);
        } catch (error) {
          // One broken row must not stall the others; the next tick retries it.
          report(error, "runner:" + workflow.id);
        }
      }
    } catch (error) {
      report(error, "runner.tick");
    } finally {
      tickRunning = false;
      if (started && !stopping) {
        const immediate = wakeRequested;
        wakeRequested = false;
        scheduleTick(immediate ? 0 : deps.config.tickIntervalMs);
      }
    }
  }

  const api = createWorkflowsApi(deps, requestTick);

  return {
    api,
    async start(): Promise<void> {
      if (started || stopping) return;
      started = true;
      // The first tick is the boot recovery: it reconciles rows a reload left behind.
      scheduleTick(0);
    },
    async stop(): Promise<void> {
      if (!started && timer === null) return;
      stopping = true;
      started = false;
      if (timer !== null) {
        timers.clearTimeout(timer);
        timer = null;
      }
      wakeRequested = false;
    },
    tick,
  };
}
