import { describe, expect, it } from "vitest";
import type { CallModelInput } from "./client";
import { MAX_SCRIPT_TURNS, type PtcRunResult } from "./ptc/protocol";
import { runTurn } from "./turn";
import {
  answer,
  capture,
  host,
  NEW_FILE,
  okRun,
  ROUTE,
  ROUTE_FIXED,
  run,
  runner,
  script,
  SIGNAL,
  settings,
} from "./turn-fixtures";

describe("runTurn with PTC exploration", () => {
  it("runs a program, returns its result to the model, then accepts the final answer", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await run([script("return await tools.list_files({})"), answer([NEW_FILE])], runner(okRun({ files: ["src/a.ts"] })), calls);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    const resultTurn = calls[1]?.messages.at(-1)?.content ?? "";
    expect(resultTurn).toContain("The program finished");
    expect(resultTurn).toContain("src/a.ts");
    expect(resultTurn).toContain("list_files");
    expect(outcome.parsed.response.patches).toEqual([NEW_FILE]);
    expect(outcome.trace).toHaveLength(1);
  });

  it("does not spend a repair round on a validator outage", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await runTurn({
      call: capture([answer([NEW_FILE])], calls),
      settings,
      system: "system",
      messages: [{ role: "user", content: "add a file" }],
      host: {
        ...host(),
        analyze: async () => {
          throw new Error("analyzer worker did not become ready");
        },
      },
      signal: SIGNAL,
      onText: () => {},
      onRepair: () => {},
      runner: runner(okRun(null, 0)),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe("validator");
    expect(calls).toHaveLength(1);
  });

  it("reports each program through the start and finish callbacks", async () => {
    const calls: CallModelInput[] = [];
    const started: string[] = [];
    const finished: string[] = [];
    const outcome = await run([script("return 1"), answer([NEW_FILE])], runner(okRun(1)), calls, {
      onScriptStart: (program, turn) => started.push(turn + ":" + program),
      onScript: (result, program) => finished.push(program + ":" + String(result.ok)),
    });

    expect(outcome.ok).toBe(true);
    expect(started).toEqual(["1:return 1"]);
    expect(finished).toEqual(["return 1:true"]);
  });

  it("tells the model when a program returned nothing", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await run([script("await tools.list_files({})"), answer([NEW_FILE])], runner(okRun(null, 1)), calls);
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
    const outcome = await run([script("while (true) {}"), answer([NEW_FILE])], runner(timeout), calls);
    expect(outcome.ok).toBe(true);
    const resultTurn = calls[1]?.messages.at(-1)?.content ?? "";
    expect(resultTurn).toContain("timeout");
    expect(resultTurn).toContain("5000ms");
  });

  it("stops after the program budget", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await run([script("return 1")], runner(okRun(1)), calls);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.message).toContain("exploration budget");
    expect(calls).toHaveLength(MAX_SCRIPT_TURNS + 1);
  });

  it("does not inline file content in a repair when the tools are available", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await run([answer([ROUTE]), answer([ROUTE_FIXED])], runner(okRun(null, 0)), calls);
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(2);
    const repair = calls[1]?.messages.at(-1)?.content ?? "";
    expect(repair).toContain("## Validation findings");
    expect(repair).toContain("## Tools");
    expect(repair).not.toContain("## Current content of the files");
  });
});
