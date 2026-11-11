import { JobError, serializeJobData } from "@facilis/core";
import type { JobDefinition, JobJson, JobListOptions } from "@facilis/core";
import { TableAccessError, type PolicyScopedDatabase } from "@facilis/db";

import type { JobCounts, JobEngine, JobEngineOptions, JobStore, StoredJob } from "./contracts.ts";
import {
  errorMessage,
  formatIssues,
  INTERRUPTED_ERROR,
  MAX_STORED_ERROR,
  normalizeLimit,
  SYSTEM_TIMERS,
} from "./engine-support.ts";

interface RunningAttempt {
  readonly controller: AbortController;
  cancelRequested: boolean;
}

type AttemptOutcome =
  | { readonly ok: true; readonly output: JobJson }
  | {
      readonly ok: false;
      readonly error: string;
      /** A declaration violation is deterministic: never requeued (D-157). */
      readonly terminal?: boolean;
    };

/**
 * The scheduler (docs/JOBS.md §7): claims due jobs, runs at most `maxConcurrent` attempts,
 * applies retry/timeout/cancel and delegates all state to the injected `JobStore`.
 */
export function createJobEngine(options: JobEngineOptions): JobEngine {
  const { definitions, store, config, executor } = options;
  const timers = options.timers ?? SYSTEM_TIMERS;
  const report = (error: unknown, context: string): void => options.onError?.(error, context);

  const running = new Map<string, RunningAttempt>();
  const attempts = new Set<Promise<void>>();
  let started = false;
  let stopping = false;
  let stopped = false;
  let tickRunning = false;
  let wakeRequested = false;
  let tickTimer: unknown = null;
  let stopPromise: Promise<void> | null = null;

  const now = (): Date => new Date(timers.now());

  function scheduleTick(delayMs: number): void {
    if (!started || stopping) return;
    if (tickTimer !== null) timers.clearTimeout(tickTimer);
    tickTimer = timers.setTimeout(() => {
      tickTimer = null;
      void tick().catch(() => undefined);
    }, delayMs);
  }

  /** Enqueue and attempt settlement ask for an immediate tick; a running tick defers to it. */
  function requestTick(delayMs: number): void {
    if (!started || stopping) return;
    if (tickRunning) {
      wakeRequested = true;
      return;
    }
    scheduleTick(delayMs);
  }

  async function tick(): Promise<void> {
    if (!started || stopping || tickRunning) return;
    tickRunning = true;
    try {
      const free = config.maxConcurrent - running.size;
      if (free <= 0) return;
      const claimed = await store.claim(now(), free);
      // A stop() racing the claim must not start work the caller is shutting down.
      if (stopping) {
        await Promise.all(claimed.map((job) => interrupt(job)));
        return;
      }
      for (const job of claimed) launch(job);
    } catch (error) {
      report(error, "engine.tick");
    } finally {
      tickRunning = false;
      if (started && !stopping) {
        const immediate = wakeRequested;
        wakeRequested = false;
        scheduleTick(immediate ? 0 : config.pollIntervalMs);
      }
    }
  }

  async function interrupt(job: StoredJob): Promise<void> {
    const finishedAt = now();
    if (job.attempts >= job.maxAttempts) {
      await store.complete(job.id, { status: "failed", error: INTERRUPTED_ERROR, finishedAt });
      return;
    }
    await store.requeue(job.id, { runAt: finishedAt, error: INTERRUPTED_ERROR });
  }

  function launch(job: StoredJob): void {
    const attempt: RunningAttempt = { controller: new AbortController(), cancelRequested: false };
    running.set(job.id, attempt);
    const promise = runAttempt(job, attempt)
      .catch((error: unknown) => report(error, `engine.attempt:${job.id}`))
      .finally(() => {
        running.delete(job.id);
        requestTick(0);
      });
    attempts.add(promise);
    void promise.finally(() => attempts.delete(promise)).catch(() => undefined);
  }

  async function runAttempt(job: StoredJob, attempt: RunningAttempt): Promise<void> {
    const definition = definitions.get(job.name);
    const outcome: AttemptOutcome =
      definition === undefined
        ? { ok: false, error: `Job "${job.name}" has no definition in this project.` }
        : await executeAttempt(job, attempt, definition);

    // Cancellation wins over a late result: once the caller asked the job to stop, its output
    // is not trusted (docs/JOBS.md §6).
    if (attempt.cancelRequested) {
      await store.complete(job.id, { status: "cancelled", error: null, finishedAt: now() });
      return;
    }
    if (outcome.ok) {
      await store.complete(job.id, {
        status: "succeeded",
        output: outcome.output,
        finishedAt: now(),
      });
      return;
    }
    if (outcome.terminal === true) {
      // Retrying cannot fix a declaration the definition does not carry: store the stable
      // code as the error and never the relation name the guard refused (D-157).
      await store.complete(job.id, { status: "failed", error: outcome.error, finishedAt: now() });
      return;
    }
    if (stopping) return interrupt(job);
    const error =
      outcome.error.length > MAX_STORED_ERROR
        ? outcome.error.slice(0, MAX_STORED_ERROR)
        : outcome.error;
    if (job.attempts < job.maxAttempts) {
      await store.requeue(job.id, { runAt: new Date(timers.now() + config.retryDelayMs), error });
      return;
    }
    await store.complete(job.id, { status: "failed", error, finishedAt: now() });
  }

  async function executeAttempt(
    job: StoredJob,
    attempt: RunningAttempt,
    definition: JobDefinition<unknown, unknown>,
  ): Promise<AttemptOutcome> {
    const parsedInput = definition.input.safeParse(job.input);
    if (!parsedInput.success) return { ok: false, error: formatIssues(parsedInput.error.issues) };

    const controller = attempt.controller;
    let timedOut = false;
    let timeoutHandle: unknown = null;
    const abort = (): void => controller.abort();
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = timers.setTimeout(() => {
        timedOut = true;
        // The signal is the contract, not a kill: the engine moves on even if the job ignores it.
        abort();
        reject(new Error("timeout"));
      }, job.timeoutMs);
    });
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      });
    });

    try {
      const raw = await Promise.race([
        Promise.resolve(
          executor({ definition, data: parsedInput.data, job, signal: controller.signal }),
        ),
        timeout,
        aborted,
      ]);
      const parsedOutput = definition.output.safeParse(raw);
      if (!parsedOutput.success)
        return { ok: false, error: formatIssues(parsedOutput.error.issues) };
      return { ok: true, output: serializeJobData(parsedOutput.data, "job_invalid_output") };
    } catch (error) {
      if (timedOut) return { ok: false, error: `timeout after ${job.timeoutMs}ms` };
      if (error instanceof TableAccessError) {
        return { ok: false, error: error.code, terminal: true };
      }
      return { ok: false, error: errorMessage(error) };
    } finally {
      if (timeoutHandle !== null) timers.clearTimeout(timeoutHandle);
    }
  }

  async function enqueue(
    name: string,
    data: unknown,
    enqueueOptions: { readonly runAt?: Date } | undefined,
    target: JobStore,
  ): Promise<{ id: string }> {
    // stop() is terminal (the boot owns the lifecycle), so this is a caller bug, not a
    // job-contract violation and therefore not a JobError code.
    if (stopping || stopped) throw new Error("The job engine is stopped.");
    const definition = definitions.get(name);
    if (definition === undefined) {
      throw new JobError("job_unknown", `Job "${name}" is not defined by this project.`);
    }
    const parsed = definition.input.safeParse(data);
    if (!parsed.success) throw new JobError("job_invalid_input", formatIssues(parsed.error.issues));
    const createdAt = now();
    const id = crypto.randomUUID();
    await target.insert({
      id,
      name,
      input: serializeJobData(parsed.data, "job_invalid_input"),
      maxAttempts: definition.maxAttempts ?? config.maxAttempts,
      timeoutMs: definition.timeoutMs ?? config.timeoutMs,
      runAt: enqueueOptions?.runAt ?? createdAt,
      createdAt,
    });
    requestTick(0);
    return { id };
  }

  async function cancel(id: string, target: JobStore): Promise<boolean> {
    const job = await target.get(id);
    if (job === null) return false;
    if (job.status === "queued") return target.cancelQueued(id, now());
    if (job.status !== "running") return false;
    const attempt = running.get(id);
    if (attempt === undefined) return false;
    attempt.cancelRequested = true;
    attempt.controller.abort();
    return true;
  }

  function start(): Promise<void> {
    if (started || stopped) return Promise.resolve();
    started = true;
    return store
      .recoverInterrupted(now())
      .catch((error: unknown) => report(error, "engine.start"))
      .then(() => {
        scheduleTick(0);
      });
  }

  function stop(): Promise<void> {
    stopPromise ??= (async (): Promise<void> => {
      if (!started) return;
      stopping = true;
      started = false;
      stopped = true;
      if (tickTimer !== null) {
        timers.clearTimeout(tickTimer);
        tickTimer = null;
      }
      for (const attempt of running.values()) attempt.controller.abort();
      await Promise.all(attempts);
      wakeRequested = false;
    })();
    return stopPromise;
  }

  /** One engine surface over one store view; timer and in-flight state stay shared. */
  function createView(target: JobStore): JobEngine {
    return {
      start,
      stop,
      enqueue: (name, data, enqueueOptions) => enqueue(name, data, enqueueOptions, target),
      get: (id) => target.get(id),
      list: (listOptions?: JobListOptions) =>
        target.list({ ...listOptions, limit: normalizeLimit(listOptions?.limit) }),
      queue: () => target.queue(),
      running: () => target.running(),
      cancel: (id) => cancel(id, target),
      stats: async (): Promise<JobCounts> => target.counts(),
    };
  }

  const engine: JobEngine = createView(store);
  // A handler's ctx.jobs is bound to the request transaction: queue operations must join it
  // (PGlite single connection), while the scheduler keeps the base store for its own ticks.
  engine.scoped = (scope: PolicyScopedDatabase): JobEngine =>
    createView(store.scoped?.(scope) ?? store);
  return engine;
}
