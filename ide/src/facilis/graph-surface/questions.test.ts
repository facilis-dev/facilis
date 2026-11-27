import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { ANSWER_QUESTION_CODES, GRAPH_QUESTION_KEYS, LENS_QUESTION_CODES } from "./questions.ts";

describe("graph question codes", () => {
  it("resolves every code to a registered English question", () => {
    for (const [code, key] of Object.entries(GRAPH_QUESTION_KEYS)) {
      const text = en[key];
      expect(text, code).toBeTruthy();
      // The tooltip is self-explaining only if it repeats the code it annotates.
      expect(text, code).toContain(code);
      expect(text.length, code).toBeGreaterThan(code.length + 10);
    }
  });

  it("covers every inspector answer id", () => {
    expect(Object.keys(ANSWER_QUESTION_CODES).toSorted()).toEqual([
      "q1",
      "q10",
      "q16",
      "q17",
      "q2",
      "q3",
      "q4",
      "q5",
      "q6",
      "q7",
      "q8",
      "q9",
    ]);
  });

  it("maps each lens to the question it answers", () => {
    expect(LENS_QUESTION_CODES).toEqual({
      security: "Q5",
      elevated: "Q4",
      shared: "Q9",
      unknown: "Q17",
      runtime: "Q18",
      changes: "Q19",
      reach: "Q20",
      prerender: "Q21",
    });
  });
});
