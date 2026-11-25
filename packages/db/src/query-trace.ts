/**
 * Query-span seam between the Postgres driver and the framework's telemetry adapter (D-203 §1).
 *
 * `@facilis.dev/db` owns the driver, so it is the layer that sees every statement; the
 * OpenTelemetry adapter lives in `@facilis.dev/nitro` and must not leak into this package
 * (the dependency points the other way). The seam is therefore a plain interface plus an
 * AsyncLocalStorage scope: the request wrapper enters the scope with the request's trace, the
 * driver reads it while executing, and nothing else changes when no framework trace is installed.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { QueryDescriptor } from "./describe-statement.ts";

/** A statement already in flight; ending it records the outcome and the duration. */
export interface QuerySpan {
  /** Ends the span; `error` marks it failed and is never exported as an attribute. */
  end(error?: unknown): void;
}

/** The framework-owned span factory the driver calls for every statement. */
export interface QueryTrace {
  startQuerySpan(descriptor: QueryDescriptor): QuerySpan;
}

const storage = new AsyncLocalStorage<QueryTrace>();

/**
 * Runs `run` with the request's trace visible to the driver. An absent trace runs the
 * callback untouched: telemetry off must cost nothing and change nothing.
 */
export function runWithQueryTrace<T>(trace: QueryTrace | undefined, run: () => T): T {
  return trace === undefined ? run() : storage.run(trace, run);
}

/** The trace of the request (or job) currently executing, if the framework installed one. */
export function currentQueryTrace(): QueryTrace | undefined {
  return storage.getStore();
}
