import { describe, expect, it } from "vitest";
import { RESET_CONFIRMATION, confirmsResetEverything } from "./reset-confirmation";

describe("confirmsResetEverything", () => {
  it("accepts the word in any case, trimming surrounding whitespace", () => {
    expect(confirmsResetEverything(RESET_CONFIRMATION)).toBe(true);
    expect(confirmsResetEverything("reset")).toBe(true);
    expect(confirmsResetEverything("  Reset \n")).toBe(true);
  });

  it("rejects an empty entry, a click-through and a near miss", () => {
    expect(confirmsResetEverything("")).toBe(false);
    expect(confirmsResetEverything("   ")).toBe(false);
    expect(confirmsResetEverything("RESETT")).toBe(false);
    expect(confirmsResetEverything("rest")).toBe(false);
    // The dialog's own label is not the word: typing what the screen says must not
    // unlock a wipe the user has not actually acknowledged.
    expect(confirmsResetEverything("reset everything")).toBe(false);
  });
});
