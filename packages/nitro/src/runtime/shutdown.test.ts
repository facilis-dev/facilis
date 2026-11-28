import { describe, expect, it } from "vitest";

import type { FacilisDb } from "@facilis.dev/db";

import type { DevDbSnapshotter } from "./dev-db-persistence.ts";
import type { JobsRuntime } from "./jobs/runtime.ts";
import type { WorkflowsRuntime } from "./workflows/runner.ts";
import {
  disposePreviousRuntime,
  registerRuntimeCloseHook,
  shutdownRuntimes,
  type CloseHookTarget,
  type RuntimeShutdownDeps,
} from "./shutdown.ts";

/** Recording fakes: only the shutdown surface is real, the rest of the runtime is unused. */
function fixtures(options: { failJobs?: boolean; failClose?: boolean } = {}) {
  const calls: string[] = [];
  const jobs = {
    stop: async (): Promise<void> => {
      calls.push("jobs.stop");
      if (options.failJobs) throw new Error("jobs stop failed");
    },
  } as unknown as JobsRuntime;
  const workflows = {
    stop: async (): Promise<void> => {
      calls.push("workflows.stop");
    },
  } as unknown as WorkflowsRuntime;
  const snapshotter = {
    stop: (): void => {
      calls.push("snapshotter.stop");
    },
    flush: async (): Promise<void> => {
      calls.push("snapshotter.flush");
    },
  } as unknown as DevDbSnapshotter;
  const db = {
    close: async (): Promise<void> => {
      calls.push("db.close");
      if (options.failClose) throw new Error("db close failed");
    },
  } as unknown as FacilisDb;
  const deps: RuntimeShutdownDeps = { db, jobs, workflows, snapshotter };
  return { calls, deps };
}

describe("registerRuntimeCloseHook", () => {
  it("registers one nitro close hook that shuts the runtimes down in order", async () => {
    const { calls, deps } = fixtures();
    const registered: (() => Promise<void>)[] = [];
    const target: CloseHookTarget = {
      hook: (name, fn) => {
        expect(name).toBe("close");
        registered.push(fn);
      },
    };
    registerRuntimeCloseHook(deps, target);
    expect(registered.length).toBe(1);
    await registered[0]?.();
    expect(calls).toEqual([
      "jobs.stop",
      "workflows.stop",
      "snapshotter.stop",
      "snapshotter.flush",
      "db.close",
    ]);
  });
});

describe("disposePreviousRuntime", () => {
  it("tears the previous evaluation's runtime down exactly once", async () => {
    const { calls, deps } = fixtures();
    registerRuntimeCloseHook(deps, { hook: () => {} });
    await disposePreviousRuntime();
    expect(calls).toEqual([
      "jobs.stop",
      "workflows.stop",
      "snapshotter.stop",
      "snapshotter.flush",
      "db.close",
    ]);
    await disposePreviousRuntime();
    expect(calls).toHaveLength(5);
  });

  it("only tears down the runtime registered last", async () => {
    const first = fixtures();
    const second = fixtures();
    registerRuntimeCloseHook(first.deps, { hook: () => {} });
    registerRuntimeCloseHook(second.deps, { hook: () => {} });
    await disposePreviousRuntime();
    expect(first.calls).toHaveLength(0);
    expect(second.calls).toHaveLength(5);
  });
});

describe("shutdownRuntimes", () => {
  it("tolerates null runtimes (a degraded boot has nothing to stop)", async () => {
    await expect(
      shutdownRuntimes({ db: null, jobs: null, workflows: null, snapshotter: null }),
    ).resolves.toBeUndefined();
  });

  it("still stops the workflows and closes the db when the jobs stop fails", async () => {
    const { calls, deps } = fixtures({ failJobs: true });
    await expect(shutdownRuntimes(deps)).rejects.toBeInstanceOf(AggregateError);
    // The cluster close is what releases PGlite's wasm timer: it must never be skipped.
    expect(calls).toEqual([
      "jobs.stop",
      "workflows.stop",
      "snapshotter.stop",
      "snapshotter.flush",
      "db.close",
    ]);
  });

  it("surfaces a db close failure after every other step ran", async () => {
    const { calls, deps } = fixtures({ failClose: true });
    const error = await shutdownRuntimes(deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((e) => (e as Error).message)).toEqual([
      "db close failed",
    ]);
    expect(calls.filter((c) => c === "db.close").length).toBe(1);
  });
});
