import { describe, expect, it } from "vitest";
import type { CallModelInput } from "./client";
import {
  answer,
  NEW_FILE,
  okRun,
  part,
  ROUTE,
  ROUTE_FIXED,
  run,
  runner,
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

  it("keeps going past the old six-part limit (D-108)", async () => {
    const calls: CallModelInput[] = [];
    const texts = Array.from({ length: 9 }, () => part([NEW_FILE], { continue: true }));
    texts.push(answer([SECOND_FILE]));
    const outcome = await run(texts, runner(okRun(null, 0)), calls);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(calls).toHaveLength(10);
    expect(outcome.parsed.response.patches).toEqual([NEW_FILE, SECOND_FILE]);
  });

  it("merges the parts and validates the complete set", async () => {
    const calls: CallModelInput[] = [];
    const seen: { part: number }[] = [];
    const outcome = await run(
      [part([NEW_FILE], { continue: true }), answer([SECOND_FILE])],
      runner(okRun(null, 0)),
      calls,
      { onPatches: (partNumber) => seen.push({ part: partNumber }) },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(calls).toHaveLength(2);
    expect(seen).toEqual([{ part: 1 }]);
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
});
