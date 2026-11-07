import { describe, expect, it } from "vitest";
import { beginTraceRun, completeTraceRun } from "./chat-trace";
import type { PtcRunResult } from "./ptc/protocol";
import type { ChatTraceRun } from "./types";

function run(overrides: Partial<PtcRunResult> = {}): PtcRunResult {
  return {
    ok: true,
    value: { files: 2 },
    toolCalls: 1,
    elapsedMs: 7,
    trace: [
      { name: "list_files", args: '{"dir":"src"}', ok: true, durationMs: 3, bytes: 12 },
    ],
    ...overrides,
  };
}

describe("PTC trace helpers", () => {
  it("marks a run as in progress before the result arrives", () => {
    const trace = beginTraceRun([], "return 1");
    expect(trace).toEqual([
      { program: "return 1", ok: false, toolCalls: 0, elapsedMs: 0, entries: [] },
    ]);
  });

  it("replaces the in-progress row with the finished run", () => {
    const started = beginTraceRun([], "return 1");
    const done = completeTraceRun(started, run(), "return 1");
    expect(done).toHaveLength(1);
    const first = done[0] as ChatTraceRun;
    expect(first.ok).toBe(true);
    expect(first.toolCalls).toBe(1);
    expect(first.elapsedMs).toBe(7);
    expect(first.entries[0]?.name).toBe("list_files");
    expect(first.error).toBeUndefined();
  });

  it("keeps the typed error of a failed program and starts a new row cleanly", () => {
    const failed = completeTraceRun(
      beginTraceRun([], "while (true) {}"),
      run({ ok: false, value: undefined, error: { kind: "timeout", message: "5s" } }),
      "while (true) {}",
    );
    expect(failed[0]?.error).toEqual({ kind: "timeout", message: "5s" });
    const second = beginTraceRun(failed, "return 2");
    expect(second.map((entry) => entry.program)).toEqual(["while (true) {}", "return 2"]);
  });

  it("completes a run even when no start row was recorded", () => {
    const done = completeTraceRun([], run(), "return 1");
    expect(done).toHaveLength(1);
  });
});
