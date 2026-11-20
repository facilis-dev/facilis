import { describe, expect, it } from "vitest";
import { INITIAL_ZEN, zenReducer } from "./graph-zen";

describe("zen reducer", () => {
  it("starts out of zen", () => {
    expect(INITIAL_ZEN.zen).toBe(false);
  });

  it("toggles in and out", () => {
    const on = zenReducer(INITIAL_ZEN, { type: "toggle" });
    expect(on.zen).toBe(true);
    expect(zenReducer(on, { type: "toggle" }).zen).toBe(false);
  });

  it("enter is idempotent and keeps the reference when already in zen", () => {
    const on = zenReducer(INITIAL_ZEN, { type: "enter" });
    expect(on.zen).toBe(true);
    expect(zenReducer(on, { type: "enter" })).toBe(on);
  });

  it("exit is idempotent and keeps the reference when already out of zen", () => {
    expect(zenReducer(INITIAL_ZEN, { type: "exit" })).toBe(INITIAL_ZEN);
    const on = zenReducer(INITIAL_ZEN, { type: "enter" });
    expect(zenReducer(on, { type: "exit" }).zen).toBe(false);
  });
});
