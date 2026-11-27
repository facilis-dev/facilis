// ide/ ships no jsdom: the drawer's Escape decision is pure, so it is tested directly.
// The real key events (Escape while typing, Escape after a dialog handled it) are the manual
// ide:smoke step in the issue.
import { describe, expect, it } from "vitest";
import { drawerEscapeCloses } from "./narrow-drawer-escape";

const plain = { key: "Escape", defaultPrevented: false, typing: false };

describe("drawerEscapeCloses", () => {
  it("closes the drawer on a plain Escape", () => {
    expect(drawerEscapeCloses(plain)).toBe(true);
  });

  it("leaves Escape to a focused text field", () => {
    expect(drawerEscapeCloses({ ...plain, typing: true })).toBe(false);
  });

  it("lets a handler that already took the key keep it", () => {
    expect(drawerEscapeCloses({ ...plain, defaultPrevented: true })).toBe(false);
  });

  it("ignores every other key", () => {
    expect(drawerEscapeCloses({ ...plain, key: "Enter" })).toBe(false);
  });
});
