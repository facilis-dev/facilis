import { describe, expect, it } from "vitest";
import type { CallModelInput } from "./client";
import { MAX_PATCH_TURNS } from "./patch-set";
import { MAX_SCRIPT_TURNS } from "./ptc/protocol";
import { MAX_MODEL_CALLS } from "./turn";
import {
  answer,
  NEW_FILE,
  okRun,
  part,
  ROUTE,
  ROUTE_FIXED,
  run,
  runner,
  script,
  SECOND_FILE,
} from "./turn-fixtures";

describe("runTurn with a patch set sent in parts (D-106)", () => {
  it("keeps the rejected files when a correction re-emits only the changed one", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await run(
      [part([NEW_FILE, ROUTE]), part([ROUTE_FIXED])],
      runner(okRun(null, 0)),
      calls,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(calls).toHaveLength(2);
    expect(outcome.parsed.response.patches).toEqual([NEW_FILE, ROUTE_FIXED]);
  });

  it("reports what consumed the model-call budget", async () => {
    const calls: CallModelInput[] = [];
    const texts: string[] = [];
    for (let index = 0; index < MAX_SCRIPT_TURNS; index += 1) texts.push(script("return 1"));
    // Answers in parts, each ending in an invalid set: the third correction runs out of calls.
    for (let round = 0; round < 4; round += 1) {
      for (let index = 0; index < MAX_PATCH_TURNS - 1; index += 1) {
        texts.push(part([NEW_FILE], { continue: true }));
      }
      texts.push(answer([ROUTE]));
    }
    const outcome = await run(texts, runner(okRun(1)), calls);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.message).toContain("whole budget");
    expect(outcome.failure.message).toContain("exploration program");
    expect(outcome.failure.message).toContain("patch part");
    expect(calls).toHaveLength(MAX_MODEL_CALLS);
  });

  it("merges the parts and validates the complete set", async () => {
    const calls: CallModelInput[] = [];
    const seen: { part: number; max: number }[] = [];
    const outcome = await run(
      [part([NEW_FILE], { continue: true }), answer([SECOND_FILE])],
      runner(okRun(null, 0)),
      calls,
      { onPatches: (partNumber, max) => seen.push({ part: partNumber, max }) },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(calls).toHaveLength(2);
    expect(seen).toEqual([{ part: 1, max: MAX_PATCH_TURNS }]);
    expect(outcome.parsed.response.patches).toEqual([NEW_FILE, SECOND_FILE]);
    const continuation = calls[1]?.messages.at(-1)?.content ?? "";
    expect(continuation).toContain("Continue the patch set");
    expect(continuation).toContain("src/new.ts (create)");
  });

  it("keeps the complete patches of a cut-off answer and asks for the rest", async () => {
    const full = part([NEW_FILE, SECOND_FILE]);
    const cut = full.slice(
      0,
      full.indexOf(JSON.stringify(SECOND_FILE)) + JSON.stringify(SECOND_FILE).length,
    );
    expect(() => JSON.parse(cut)).toThrow();

    const calls: CallModelInput[] = [];
    const outcome = await run([cut, answer([])], runner(okRun(null, 0)), calls);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.parsed.response.patches).toEqual([NEW_FILE, SECOND_FILE]);
    expect(calls[1]?.messages.at(-1)?.content).toContain("cut off");
    expect(calls[1]?.messages.at(-1)?.content).toContain("src/second.ts (create)");
  });

  it("stops when the patch set needs more parts than the budget allows", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await run([part([NEW_FILE], { continue: true })], runner(okRun(null, 0)), calls);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe("parse");
    expect(outcome.failure.message).toContain("more than " + MAX_PATCH_TURNS);
    expect(calls).toHaveLength(MAX_PATCH_TURNS);
  });
});
