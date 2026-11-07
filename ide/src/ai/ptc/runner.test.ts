import { describe, expect, it } from "vitest";
import {
  MAX_PROGRAM_CHARS,
  MAX_TOOL_RESULT_CHARS,
  PtcToolError,
  type PtcChild,
  type PtcChildFactory,
  type PtcJson,
  type PtcRunOptions,
  type PtcRunResult,
  type PtcToolExecutor,
  type PtcToolSpec,
} from "./protocol";
import { createPtcRunner } from "./runner";

const SPECS: readonly PtcToolSpec[] = [
  { name: "echo", signature: "echo({ value })", description: "Echo a value." },
];

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface ToolReply {
  type: "tool-result";
  id: number;
  ok: boolean;
  value?: unknown;
  error?: { kind: string; message: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolReplies(child: FakeChild): ToolReply[] {
  return child.posted.filter(
    (message): message is ToolReply => isRecord(message) && message.type === "tool-result",
  );
}

interface FakeChild extends PtcChild {
  readonly posted: unknown[];
  readonly terminateReasons: string[];
  emit(data: unknown): void;
}

/** A scripted transport: the test decides exactly what the sandbox "says". */
function fakeChild(): FakeChild {
  const listeners = new Set<(data: unknown) => void>();
  const posted: unknown[] = [];
  const terminateReasons: string[] = [];
  return {
    posted,
    terminateReasons,
    post(message) {
      posted.push(message);
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    terminate(reason) {
      terminateReasons.push(reason);
    },
    emit(data) {
      for (const listener of listeners) listener(data);
    },
  };
}

function harness(options: { executor?: PtcToolExecutor; timeoutMs?: number } = {}) {
  const children: FakeChild[] = [];
  const childFactory: PtcChildFactory = {
    async create() {
      const child = fakeChild();
      children.push(child);
      return child;
    },
  };
  const runner = createPtcRunner({
    childFactory,
    executor: options.executor ?? {
      specs: () => SPECS,
      execute: async (call) => ({ tool: call.name, args: call.args as PtcJson }),
    },
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  const lastChild = (): FakeChild => {
    const child = children.at(-1);
    if (child === undefined) throw new Error("the runner did not create a child");
    return child;
  };
  return { runner, children, lastChild };
}

/** Start a run, let create() resolve, hand back the child so the test can script it. */
async function startRun(
  harnessed: ReturnType<typeof harness>,
  program = "return 1",
  options: PtcRunOptions = {},
): Promise<{ result: Promise<PtcRunResult>; child: FakeChild }> {
  const result = harnessed.runner.run(program, options);
  await tick();
  return { result, child: harnessed.lastChild() };
}

/** A run whose only scripted event is the final result. */
async function runWithResult(value: unknown): Promise<{ result: PtcRunResult; child: FakeChild }> {
  const harnessed = harness();
  const { result: pending, child } = await startRun(harnessed);
  child.emit({ type: "result", value });
  return { result: await pending, child };
}

describe("createPtcRunner", () => {
  it("exposes the executor's tool specs", () => {
    expect(harness().runner.specs()).toEqual(SPECS);
  });

  it("returns a lossless JSON result and terminates the child on completion", async () => {
    const harnessed = harness();
    const { result: pending, child } = await startRun(harnessed);
    expect(child.posted[0]).toEqual({
      type: "run",
      runId: expect.any(String),
      program: "return 1",
    });
    child.emit({ type: "result", value: { answer: 42 } });
    const result = await pending;
    expect(result).toMatchObject({ ok: true, value: { answer: 42 }, toolCalls: 0, trace: [] });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(child.terminateReasons).toEqual(["completed"]);
  });

  it("round-trips a tool call, records the trace and maps a throw to a typed error", async () => {
    const calls: { name: string; args: unknown }[] = [];
    const harnessed = harness({
      executor: {
        specs: () => SPECS,
        execute: async (call) => {
          calls.push({ name: call.name, args: call.args });
          if (call.name === "explode") throw new PtcToolError("capability", "refused: secret path");
          return { echoed: true };
        },
      },
    });
    const { result: pending, child } = await startRun(harnessed);

    child.emit({ type: "tool", id: 1, name: "echo", args: { value: 7 } });
    child.emit({ type: "tool", id: 2, name: "explode", args: {} });
    await tick();
    expect(calls).toEqual([
      { name: "echo", args: { value: 7 } },
      { name: "explode", args: {} },
    ]);
    const replies = toolReplies(child);
    expect(replies[0]).toEqual({ type: "tool-result", id: 1, ok: true, value: { echoed: true } });
    // A refused call is a rejection the program can catch, never an escaped exception.
    expect(replies[1]).toEqual({
      type: "tool-result",
      id: 2,
      ok: false,
      error: { kind: "capability", message: "refused: secret path" },
    });

    child.emit({ type: "result", value: { done: true } });
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.toolCalls).toBe(2);
    expect(result.trace).toHaveLength(2);
    expect(result.trace[0]).toMatchObject({ name: "echo", args: '{"value":7}', ok: true });
    expect(result.trace[0]?.bytes).toBeGreaterThan(0);
    expect(result.trace[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.trace[1]).toMatchObject({ name: "explode", ok: false });
    expect(result.trace[1]?.error).toContain("refused");
    expect(child.terminateReasons).toEqual(["completed"]);
  });

  it("serves every tool call a program makes (no call budget, D-108)", async () => {
    const harnessed = harness();
    const { result: pending, child } = await startRun(harnessed);
    for (let id = 1; id <= 40; id += 1) {
      child.emit({ type: "tool", id, name: "echo", args: { id } });
    }
    await tick();
    const replies = toolReplies(child);
    expect(replies).toHaveLength(40);
    expect(replies.every((reply) => reply.ok)).toBe(true);

    child.emit({ type: "result", value: "done" });
    const result = await pending;
    expect(result).toMatchObject({ ok: true, value: "done", toolCalls: 40 });
  });

  it("times out, terminates the child and reports a typed error", async () => {
    const harnessed = harness({ timeoutMs: 20 });
    const result = await harnessed.runner.run("while (true) {}");
    expect(result.error?.kind).toBe("timeout");
    expect(result.error?.message).toContain("20ms");
    expect(harnessed.lastChild().terminateReasons).toEqual(["timeout"]);
  });

  it("aborts an in-flight run and ignores an already-aborted signal", async () => {
    const controller = new AbortController();
    const harnessed = harness({ timeoutMs: 5_000 });
    const pending = harnessed.runner.run("return 1", { signal: controller.signal });
    await tick();
    const child = harnessed.lastChild();
    controller.abort();
    const result = await pending;
    expect(result.error?.kind).toBe("abort");
    expect(child.terminateReasons).toEqual(["abort"]);

    const preAborted = new AbortController();
    preAborted.abort();
    const second = harness();
    const early = await second.runner.run("return 1", { signal: preAborted.signal });
    expect(early.error?.kind).toBe("abort");
    expect(second.children).toHaveLength(0);
  });

  it("maps an oversized or non-JSON result to output-limit", async () => {
    const huge = await runWithResult({ blob: "x".repeat(MAX_TOOL_RESULT_CHARS + 1) });
    expect(huge.result.error?.kind).toBe("output-limit");
    expect(huge.child.terminateReasons).toEqual(["output-limit"]);

    // No JSON value at all (undefined) and a JSON.stringify failure (BigInt/circular)
    // are both refused at the wire boundary.
    expect((await runWithResult(undefined)).result.error?.kind).toBe("output-limit");
    expect((await runWithResult({ big: BigInt(1) })).result.error?.kind).toBe("output-limit");

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect((await runWithResult(circular)).result.error?.kind).toBe("output-limit");
  });

  it("treats protocol garbage as a protocol failure", async () => {
    const garbage = ["hello", { type: "nonsense" }, { type: "error", kind: 7, message: "nope" }];
    for (const message of garbage) {
      const harnessed = harness();
      const { result: pending, child } = await startRun(harnessed);
      child.emit(message);
      const result = await pending;
      expect(result.error?.kind).toBe("protocol");
      expect(child.terminateReasons).toEqual(["protocol"]);
    }
  });

  it("surfaces a child-reported error without losing its kind", async () => {
    const harnessed = harness();
    const { result: pending, child } = await startRun(harnessed);
    child.emit({ type: "error", kind: "capability", message: "a forbidden tool was used" });
    const result = await pending;
    expect(result.error).toEqual({ kind: "capability", message: "a forbidden tool was used" });
    expect(child.terminateReasons).toEqual(["completed"]);
  });

  it("refuses an oversized program before creating a child", async () => {
    const harnessed = harness();
    const result = await harnessed.runner.run("x".repeat(MAX_PROGRAM_CHARS + 1));
    expect(result).toMatchObject({ ok: false, toolCalls: 0 });
    expect(result.error?.kind).toBe("capability");
    expect(harnessed.children).toHaveLength(0);
  });

  it("aborts an in-flight run on dispose", async () => {
    const harnessed = harness({ timeoutMs: 5_000 });
    const { result: pending, child } = await startRun(harnessed);
    harnessed.runner.dispose();
    const result = await pending;
    expect(result.error?.kind).toBe("abort");
    expect(child.terminateReasons).toContain("disposed");
  });
});
