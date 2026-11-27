// The write prompt's declared-surface rule (D-226, #234): the model must know that a
// non-standard capability needs a real, in-code declaration the user then confirms — otherwise
// it would try to hide the capability or drop it instead of declaring it.

import { describe, expect, it } from "vitest";

import { WRITE_PROMPT } from "./prompt-write";

describe("WRITE_PROMPT declared surface", () => {
  it("names every declaration form and forbids hiding or bypassing one", () => {
    for (const token of [
      "defineRawRoute({ reason, auth })",
      "defineServerExtension({ reason })",
      "rawSql: { reason }",
      "ctx.rawDb({ reason })",
      "// dynamic-code: <reason>",
      "The IDE asks the user to confirm each declaration",
      "never hide it, never bypass it",
    ]) {
      expect(WRITE_PROMPT).toContain(token);
    }
  });

  it("keeps the rule about the confirmation pause beside it", () => {
    expect(WRITE_PROMPT).toContain("a real, specific reason");
  });
});
