import { describe, expect, it } from "vitest";
import type { CallModelInput } from "./client";
import type { GraphViewAccess } from "./graph-view-access";
import type { PtcRunResult } from "./ptc/protocol";
import { runTurn } from "./turn";
import type { ChatTraceCall } from "./types";
import {
  answer,
  capture,
  host,
  okRun,
  patchedAnswer,
  previewAccess,
  run,
  runner,
  script,
  SIGNAL,
  settings,
} from "./turn-fixtures";

describe("runTurn with PTC exploration", () => {
  it("runs a program, returns its result to the model, then accepts the final answer", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await run(
      [script("return await tools.list_files({})"), answer()],
      runner(okRun({ files: ["src/a.ts"] })),
      calls,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    const resultTurn = calls[1]?.messages.at(-1)?.content ?? "";
    expect(resultTurn).toContain("The program finished");
    expect(resultTurn).toContain("src/a.ts");
    expect(resultTurn).toContain("list_files");
    expect(outcome.parsed.response.message).toBe("Here is the change.");
    expect(outcome.trace).toHaveLength(1);
  });

  it("rejects a returned patch set and asks for the write tools", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await run([patchedAnswer(), answer()], runner(okRun(null, 0)), calls);
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(2);
    const repair = calls[1]?.messages.at(-1)?.content ?? "";
    expect(repair).toContain("patches: not part of the response");
    expect(repair).toContain("write_file/delete_file");
    if (!outcome.ok) return;
    expect(outcome.parsed.response.message).toBe("Here is the change.");
  });

  it("reports each program through the start and finish callbacks", async () => {
    const calls: CallModelInput[] = [];
    const started: string[] = [];
    const finished: string[] = [];
    const outcome = await run([script("return 1"), answer()], runner(okRun(1)), calls, {
      onScriptStart: (program, turn) => started.push(turn + ":" + program),
      onScript: (result, program) => finished.push(program + ":" + String(result.ok)),
    });

    expect(outcome.ok).toBe(true);
    expect(started).toEqual(["1:return 1"]);
    expect(finished).toEqual(["return 1:true"]);
  });

  it("tells the model when a program returned nothing", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await run(
      [script("await tools.list_files({})"), answer()],
      runner(okRun(null, 1)),
      calls,
    );
    expect(outcome.ok).toBe(true);
    expect(calls[1]?.messages.at(-1)?.content).toContain("returned no value");
  });

  it("feeds a failed program back as data and lets the model recover", async () => {
    const calls: CallModelInput[] = [];
    const timeout: PtcRunResult = {
      ok: false,
      error: { kind: "timeout", message: "the program exceeded 5000ms" },
      toolCalls: 0,
      elapsedMs: 5000,
      trace: [],
    };
    const outcome = await run([script("while (true) {}"), answer()], runner(timeout), calls);
    expect(outcome.ok).toBe(true);
    const resultTurn = calls[1]?.messages.at(-1)?.content ?? "";
    expect(resultTurn).toContain("timeout");
    expect(resultTurn).toContain("5000ms");
  });

  it("keeps exploring until the model answers (D-108)", async () => {
    const calls: CallModelInput[] = [];
    const texts = [...Array.from({ length: 10 }, () => script("return 1")), answer()];
    const outcome = await run(texts, runner(okRun(1)), calls);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(calls).toHaveLength(11);
    expect(outcome.parsed.response.message).toBe("Here is the change.");
  });

  it("attaches screenshots to the tool result and to the activity callback (D-112)", async () => {
    const calls: CallModelInput[] = [];
    const images = ["data:image/jpeg;base64,QUJD"];
    const seen: (readonly string[])[] = [];
    const outcome = await run([script("return 1"), answer()], runner(okRun(1)), calls, {
      preview: previewAccess({ takeImages: () => images }),
      onScript: (_result, _program, captured) => seen.push(captured),
    });
    expect(outcome.ok).toBe(true);
    expect(seen).toEqual([images]);
    const resultTurn = calls[1]?.messages.at(-1);
    expect(resultTurn?.role).toBe("user");
    expect(resultTurn?.images).toEqual(images);
  });

  it("attaches preview and project-graph screenshots to the tool result (D-171)", async () => {
    const calls: CallModelInput[] = [];
    const preview = "data:image/jpeg;base64,UFJFVg==";
    const graph = "data:image/jpeg;base64,R1JBUEg=";
    const seen: (readonly string[])[] = [];
    const graphView: GraphViewAccess = {
      highlight: async () => ({}),
      paths: async () => ({}),
      capture: async () => ({}),
      takeImages: () => [graph],
    };
    const outcome = await runTurn({
      call: capture([script("return 1"), answer()], calls),
      settings,
      system: "system",
      messages: [{ role: "user", content: "inspect the graph" }],
      host: {
        ...host(),
        preview: previewAccess({ takeImages: () => [preview] }),
        graphView,
      },
      signal: SIGNAL,
      onText: () => {},
      onRepair: () => {},
      runner: runner(okRun(1)),
      onScript: (_result, _program, captured) => seen.push(captured),
    });
    expect(outcome.ok).toBe(true);
    expect(seen).toEqual([[preview, graph]]);
    expect(calls[1]?.messages.at(-1)?.images).toEqual([preview, graph]);
  });

  it("records one activity row per model call with its outcome (D-110)", async () => {
    const calls: CallModelInput[] = [];
    const activity: ChatTraceCall[] = [];
    const started: number[] = [];
    const outcome = await run([script("return 1"), answer()], runner(okRun(1)), calls, {
      onCallStart: (call) => started.push(call),
      onCall: (entry) => activity.push(entry),
    });
    expect(outcome.ok).toBe(true);
    expect(started).toEqual([1, 2]);
    expect(activity.map((entry) => entry.outcome)).toEqual(["script", "answer"]);
    expect(activity[0]).toMatchObject({ kind: "call", n: 1, truncated: false });
    expect(activity[1]?.n).toBe(2);
  });

  it("streams the reasoning to the UI and stores it on the call row (D-110)", async () => {
    const chunks: string[] = [];
    const activity: ChatTraceCall[] = [];
    const outcome = await runTurn({
      call: async (input) => {
        input.onReasoning?.("thinking ");
        input.onReasoning?.("hard");
        return { ok: true, text: answer(), reasoning: "thinking hard" };
      },
      settings,
      system: "system",
      messages: [{ role: "user", content: "add a file" }],
      host: host(),
      signal: SIGNAL,
      onText: () => {},
      onRepair: () => {},
      runner: runner(okRun(null, 0)),
      onReasoning: (chunk) => chunks.push(chunk),
      onCall: (entry) => activity.push(entry),
    });
    expect(outcome.ok).toBe(true);
    expect(chunks).toEqual(["thinking ", "hard"]);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ n: 1, reasoningChars: 13, outcome: "answer" });
    expect(activity[0]?.reasoning).toBe("thinking hard");
  });
});
