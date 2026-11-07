// The PTC program runner: one sandboxed child per program, tool RPC, size limits and
// timeout (docs/PTC.md §4–§5, D-101). Browser-free on purpose: runner-frame.ts supplies the
// real transport and the tests a scripted fake, so the lifecycle is unit-tested without a
// browser. Every failure is data: the model must be able to recover inside the turn loop.

import {
  boundedJson,
  isPtcToolError,
  isRunResultMessage,
  isToolRequest,
  MAX_PROGRAM_CHARS,
  MAX_TOOL_RESULT_CHARS,
  RUN_TIMEOUT_MS,
  type PtcChild,
  type PtcChildFactory,
  type PtcFailureKind,
  type PtcRunOptions,
  type PtcRunResult,
  type PtcRunner,
  type PtcToolExecutor,
  type PtcTraceEntry,
} from "./protocol";

export interface PtcRunnerOptions {
  childFactory: PtcChildFactory;
  /** A fixed executor (tests). Prefer executorFactory in the IDE. */
  executor?: PtcToolExecutor;
  /**
   * One router per run: the analyzer facts are cached inside the router, so a router that
   * outlived a turn would answer from the pre-edit project (the user may have applied a
   * patch in between). Creating one per program is cheap until a tool actually runs.
   */
  executorFactory?: () => PtcToolExecutor;
  /** Wall-clock cap for one program; defaults to RUN_TIMEOUT_MS. */
  timeoutMs?: number;
}

import {
  errorMessage,
  fail,
  isFailureKind,
  jsonLength,
  resultOf,
  type ToolRequest,
} from "./runner-result";

export function createPtcRunner(options: PtcRunnerOptions): PtcRunner {
  const { childFactory, timeoutMs = RUN_TIMEOUT_MS } = options;
  const resolveExecutor = (): PtcToolExecutor => {
    const factory = options.executorFactory;
    if (factory !== undefined) return factory();
    const fixed = options.executor;
    if (fixed === undefined) {
      throw new Error("createPtcRunner needs an executor or an executorFactory");
    }
    return fixed;
  };
  const live = new Set<PtcChild>();
  const aborts = new Set<AbortController>();
  let disposed = false;
  let runSequence = 0;

  async function run(program: string, runOptions: PtcRunOptions = {}): Promise<PtcRunResult> {
    const startedAt = Date.now();
    const trace: PtcTraceEntry[] = [];
    if (disposed) return fail(startedAt, trace, "capability", "the PTC runner is disposed");
    // A program is untrusted input like any other: refuse it before it reaches a sandbox.
    if (program.length > MAX_PROGRAM_CHARS) {
      const message = "program is " + program.length + " chars; the limit is " + MAX_PROGRAM_CHARS;
      return fail(startedAt, trace, "capability", message);
    }
    if (runOptions.signal?.aborted === true) {
      return fail(startedAt, trace, "abort", "run was aborted before it started");
    }

    // One executor per program: see PtcRunnerOptions.executorFactory.
    const executor = resolveExecutor();
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    runOptions.signal?.addEventListener("abort", forwardAbort, { once: true });
    aborts.add(controller);

    let child: PtcChild | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unbind: (() => void) | undefined;
    let terminateReason = "completed";

    try {
      try {
        child = await childFactory.create();
      } catch (error) {
        return fail(
          startedAt,
          trace,
          "exception",
          "could not create the sandbox: " + errorMessage(error),
        );
      }
      if (disposed || controller.signal.aborted) {
        terminateReason = "abort";
        return fail(startedAt, trace, "abort", "run was aborted before it started");
      }
      // A const alias keeps the narrowing inside the promise executor; child stays mutable.
      const activeChild = child;
      live.add(activeChild);

      const result = await new Promise<PtcRunResult>((resolve) => {
        let settled = false;
        const settle = (outcome: PtcRunResult, reason: string) => {
          if (settled) return;
          settled = true;
          terminateReason = reason;
          if (timer !== undefined) clearTimeout(timer);
          unbind?.();
          controller.signal.removeEventListener("abort", onAbort);
          resolve(outcome);
        };
        // The termination reason mirrors the kind so a dropped frame is diagnosable.
        const didFail = (kind: PtcFailureKind, message: string) => {
          settle(fail(startedAt, trace, kind, message), kind);
        };
        const onAbort = () => didFail("abort", "run was aborted");

        const replyTool = (payload: Record<string, unknown>) => {
          if (!settled) activeChild.post(payload);
        };
        const replyToolError = (id: number, error: { kind: PtcFailureKind; message: string }) => {
          replyTool({ type: "tool-result", id, ok: false, error });
        };

        const handleToolCall = (request: ToolRequest) => {
          const entry: PtcTraceEntry = {
            name: request.name,
            args: boundedJson(request.args),
            ok: false,
            durationMs: 0,
            bytes: 0,
          };
          // The entry is recorded at request time, before the executor runs, so a failed
          // or still-pending call is visible in the trace too.
          trace.push(entry);
          if (jsonLength(request.args) === null) {
            entry.error = "arguments are not lossless JSON";
            replyToolError(request.id, { kind: "protocol", message: entry.error });
            return;
          }
          const callStartedAt = Date.now();
          void Promise.resolve()
            .then(() =>
              executor.execute(
                { name: request.name, args: request.args },
                { signal: controller.signal },
              ),
            )
            .then(
              (value) => {
                entry.durationMs = Date.now() - callStartedAt;
                if (settled) return;
                const bytes = jsonLength(value);
                if (bytes === null) {
                  entry.error = "the tool returned a value that is not lossless JSON";
                  replyToolError(request.id, { kind: "output-limit", message: entry.error });
                  return;
                }
                entry.ok = true;
                entry.bytes = bytes;
                replyTool({ type: "tool-result", id: request.id, ok: true, value });
              },
              (error: unknown) => {
                entry.durationMs = Date.now() - callStartedAt;
                entry.error = errorMessage(error);
                replyToolError(request.id, {
                  kind: isPtcToolError(error) ? error.kind : "exception",
                  message: entry.error,
                });
              },
            );
        };

        const handleMessage = (data: unknown) => {
          if (settled) return;
          if (isToolRequest(data)) {
            handleToolCall(data);
            return;
          }
          if (!isRunResultMessage(data)) {
            didFail("protocol", "unexpected message from the sandbox: " + boundedJson(data));
            return;
          }
          if (data.type === "result") {
            const bytes = jsonLength(data.value);
            if (bytes === null) {
              didFail("output-limit", "the program result is not lossless JSON");
              return;
            }
            if (bytes > MAX_TOOL_RESULT_CHARS) {
              didFail(
                "output-limit",
                "the program result is " + bytes + " chars; the limit is " + MAX_TOOL_RESULT_CHARS,
              );
              return;
            }
            settle(resultOf(startedAt, trace, true, data.value, undefined), "completed");
            return;
          }
          if (!isFailureKind(data.kind)) {
            didFail("protocol", "unknown sandbox error kind: " + boundedJson(data.kind));
            return;
          }
          settle(
            fail(
              startedAt,
              trace,
              data.kind,
              typeof data.message === "string" && data.message.length > 0
                ? data.message
                : "the program failed",
            ),
            "completed",
          );
        };

        unbind = activeChild.onMessage(handleMessage);
        controller.signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => {
          didFail("timeout", "the program exceeded its " + timeoutMs + "ms wall-clock limit");
        }, timeoutMs);
        activeChild.post({ type: "run", runId: "ptc-run-" + String(++runSequence), program });
      });
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      unbind?.();
      runOptions.signal?.removeEventListener("abort", forwardAbort);
      aborts.delete(controller);
      if (child !== undefined) {
        live.delete(child);
        // Always: a finished program must not keep a timed-out worker, a listener or a
        // hidden iframe alive. terminate() is the contract, not process isolation.
        child.terminate(terminateReason);
      }
    }
  }

  return {
    specs: () => (options.executor ?? resolveExecutor()).specs(),
    run,
    dispose() {
      disposed = true;
      for (const controller of aborts) controller.abort();
      for (const child of live) child.terminate("disposed");
    },
  };
}
