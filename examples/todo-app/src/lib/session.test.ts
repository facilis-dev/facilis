import { afterEach, describe, expect, it, vi } from "vitest";
import { hasPermission, rememberEmail, rememberedEmail } from "./session.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => {
      values.clear();
    },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("hasPermission", () => {
  it("is false without an authenticated session", () => {
    expect(hasPermission(null, "todos:read")).toBe(false);
    expect(hasPermission({ authenticated: false }, "todos:read")).toBe(false);
  });

  it("checks the session permission list", () => {
    const session = { authenticated: true, permissions: ["todos:read", "todos:write"] };
    expect(hasPermission(session, "todos:write")).toBe(true);
    expect(hasPermission(session, "users:read")).toBe(false);
    expect(hasPermission({ authenticated: true }, "todos:read")).toBe(false);
  });
});

describe("rememberEmail", () => {
  it("round-trips the display email through storage", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    rememberEmail("giulia@example.com");
    expect(rememberedEmail()).toBe("giulia@example.com");
  });

  it("degrades to null when storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(rememberedEmail()).toBeNull();
    expect(() => rememberEmail("giulia@example.com")).not.toThrow();
  });
});
