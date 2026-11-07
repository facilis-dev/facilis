import { describe, expect, it } from "vitest";
import {
  appendReasoning,
  beginTraceCall,
  beginTraceRun,
  capReasoning,
  completeTraceCall,
  completeTraceRun,
} from "./chat-trace";
import type { PtcRunResult } from "./ptc/protocol";
import type { ChatTraceCall, ChatTraceRun } from "./types";

function run(overrides: Partial<PtcRunResult> = {}): PtcRunResult {
  return {
    ok: true,
    value: { files: 2 },
    toolCalls: 1,
    elapsedMs: 7,
    trace: [{ name: "list_files", args: '{"dir":"src"}', ok: true, durationMs: 3, bytes: 12 }],
    ...overrides,
  };
}

function call(overrides: Partial<ChatTraceCall> = {}): ChatTraceCall {
  return {
    kind: "call",
    n: 1,
    elapsedMs: 10,
    chars: 100,
    reasoningChars: 0,
    outcome: "answer",
    truncated: false,
    ...overrides,
  };
}

describe("activity trace helpers", () => {
  it("marks a run as in progress before the result arrives", () => {
    const trace = beginTraceRun([], "return 1");
    expect(trace).toEqual([
      { kind: "run", program: "return 1", ok: false, toolCalls: 0, elapsedMs: 0, entries: [] },
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
    const first = failed[0] as ChatTraceRun;
    expect(first.error).toEqual({ kind: "timeout", message: "5s" });
    const second = beginTraceRun(failed, "return 2");
    expect(second.map((entry) => (entry.kind === "run" ? entry.program : ""))).toEqual([
      "while (true) {}",
      "return 2",
    ]);
  });

  it("completes a run even when no start row was recorded", () => {
    const done = completeTraceRun([], run(), "return 1");
    expect(done).toHaveLength(1);
  });

  it("carries the screenshots the program captured on its row (D-112)", () => {
    const image = "data:image/jpeg;base64,QUJD";
    const done = completeTraceRun([], run(), "return 1", [image]);
    expect(done[0]).toMatchObject({ images: [image] });
  });

  it("inserts the call row in place and completes it without moving it", () => {
    const started = beginTraceCall([], 1);
    expect(started).toEqual([
      {
        kind: "call",
        n: 1,
        elapsedMs: 0,
        chars: 0,
        reasoningChars: 0,
        outcome: "running",
        truncated: false,
      },
    ]);
    const done = completeTraceCall(started, call({ n: 1 }));
    expect(done).toEqual([call({ n: 1 })]);
    // The row keeps its position when a program follows and the next call starts.
    const withRun = beginTraceRun(done, "return 1");
    const withNext = beginTraceCall(withRun, 2);
    expect(withNext.map((entry) => entry.kind)).toEqual(["call", "run", "call"]);
    const completed = completeTraceCall(withNext, call({ n: 2, outcome: "script" }));
    expect(completed[2]).toMatchObject({ n: 2, outcome: "script" });
  });

  it("keeps the tail of the live reasoning and caps the stored one", () => {
    expect(appendReasoning(null, "abc", 10)).toBe("abc");
    expect(appendReasoning("abc", "def", 4)).toBe("…def");
    expect(capReasoning("x".repeat(10), 4)).toBe("…xxx");
    expect(capReasoning("ok", 4)).toBe("ok");
  });
});
