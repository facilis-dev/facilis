import { afterEach, describe, expect, it, vi } from "vitest";
import { hasPermission, loginTarget, rememberEmail, rememberedEmail } from "./session.tsx";

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
    expect(hasPermission(null, "users:read")).toBe(false);
    expect(hasPermission({ authenticated: false }, "users:read")).toBe(false);
  });

  it("checks the session permission list", () => {
    const session = { authenticated: true, permissions: ["users:read"] };
    expect(hasPermission(session, "users:read")).toBe(true);
    expect(hasPermission(session, "users:write")).toBe(false);
    expect(hasPermission({ authenticated: true }, "users:read")).toBe(false);
  });
});

describe("loginTarget", () => {
  it("honours the path a guard remembered", () => {
    expect(loginTarget({ from: "/settings" })).toBe("/settings");
  });

  it("falls back to the dashboard", () => {
    expect(loginTarget(undefined)).toBe("/");
    expect(loginTarget({ from: "" })).toBe("/");
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
