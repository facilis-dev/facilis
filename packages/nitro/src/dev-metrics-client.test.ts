// Behavior of the injected dev metrics client, exercised in a sandbox with the REAL
// source string (the spike that first proved it is retired; this is its regression
// coverage). The sandbox stands in for the preview document: window, location,
// performance and the parent postMessage channel.
import { describe, expect, it } from "vitest";

import { DEV_METRICS_CLIENT_SOURCE, DEV_METRICS_MARKER } from "./dev-metrics-client.ts";

interface Sample {
  route: string;
  method: string;
  status: number;
  duration: number;
}
interface Batch {
  source: string;
  type: string;
  token: string;
  samples: Sample[];
}
type MessageListener = (event: { source: unknown; data: unknown }) => void;

const ORIGIN = "http://localhost:3000";

class FakeXhr {
  status = 0;
  private readonly listeners = new Map<string, (() => void)[]>();
  open(_method: string, _url: string): void {}
  send(): void {
    setTimeout(() => {
      this.status = 200;
      for (const fn of this.listeners.get("loadend") ?? []) fn.call(this);
    }, 0);
  }
  addEventListener(type: string, fn: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
}

function sandbox(fetchImpl?: (url: string, init?: { method?: string }) => Promise<{ status: number }>) {
  const batches: Batch[] = [];
  let onMessage: MessageListener | undefined;
  let flushFn: (() => void) | undefined;
  const win: Record<string, unknown> = {
    fetch: fetchImpl ?? (async () => ({ status: 200 })),
    XMLHttpRequest: FakeXhr,
    addEventListener: (type: string, fn: MessageListener) => {
      if (type === "message") onMessage = fn;
    },
    parent: { postMessage: (message: Batch) => batches.push(message) },
  };
  const location = { href: ORIGIN + "/", origin: ORIGIN };
  const install = () =>
    new Function("window", "location", "performance", "setInterval", "clearInterval", DEV_METRICS_CLIENT_SOURCE)(
      win,
      location,
      performance,
      (fn: () => void) => {
        flushFn = fn;
        return 1;
      },
      () => {},
    );
  install();
  const send = (data: unknown, source: unknown = win.parent) => onMessage?.({ source, data });
  const enable = (routes: string[]) =>
    send({ source: "vv-metrics", type: "enable", token: "tok", routes });
  return { win, batches, enable, send, install, flush: () => flushFn?.() };
}

const samplesOf = (batches: Batch[]): Sample[] => batches.flatMap((b) => b.samples);

describe("dev metrics client", () => {
  it("carries the production-grep marker", () => {
    expect(DEV_METRICS_CLIENT_SOURCE).toContain(DEV_METRICS_MARKER);
  });

  it("is dormant until enabled: no wrap, no samples", async () => {
    const s = sandbox();
    const before = s.win.fetch;
    await (s.win.fetch as (u: string) => Promise<{ status: number }>)("/api/todos");
    s.flush();
    expect(s.win.fetch).toBe(before);
    expect(s.batches).toEqual([]);
  });

  it("records matched requests as template + method + status + duration", async () => {
    const s = sandbox();
    s.enable(["/api/todos", "/api/todos/{id}"]);
    const fetch = s.win.fetch as (u: string, i?: { method?: string }) => Promise<{ status: number }>;
    await fetch("/api/todos");
    await fetch("/api/todos/42", { method: "PATCH" });
    s.flush();
    expect(s.batches).toHaveLength(1);
    expect(s.batches[0]?.token).toBe("tok");
    expect(s.batches[0]?.source).toBe("vv-metrics");
    expect(samplesOf(s.batches)).toEqual([
      { route: "/api/todos", method: "GET", status: 200, duration: expect.any(Number) },
      { route: "/api/todos/{id}", method: "PATCH", status: 200, duration: expect.any(Number) },
    ]);
  });

  it("matches every template convention and drops unmatched paths", async () => {
    const s = sandbox();
    s.enable(["/a/{id}", "/b/[id]", "/c/{id?}", "/d/{...slug}", "/e/[[...slug]]", "/static"]);
    const fetch = s.win.fetch as (u: string) => Promise<{ status: number }>;
    for (const path of ["/a/1", "/b/2", "/c/3", "/c", "/d/x/y", "/e", "/e/x", "/static", "/nope", "/a/1/2"]) {
      await fetch(path);
    }
    s.flush();
    const routes = samplesOf(s.batches).map((x) => x.route);
    expect(routes).toEqual(["/a/{id}", "/b/[id]", "/c/{id?}", "/c/{id?}", "/d/{...slug}", "/e/[[...slug]]", "/e/[[...slug]]", "/static"]);
  });

  it("never leaks query strings, hashes or cross-origin URLs", async () => {
    const s = sandbox();
    s.enable(["/api/todos/{id}"]);
    const fetch = s.win.fetch as (u: string) => Promise<{ status: number }>;
    await fetch("/api/todos/9?secret=x#frag");
    await fetch("https://other.example/api/todos/9");
    await fetch("/assets/app.js");
    s.flush();
    const samples = samplesOf(s.batches);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.route).toBe("/api/todos/{id}");
    expect(JSON.stringify(samples)).not.toContain("secret");
  });

  it("records a rejected fetch as status 0 and propagates the rejection", async () => {
    const s = sandbox(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    s.enable(["/api/todos"]);
    const fetch = s.win.fetch as (u: string) => Promise<{ status: number }>;
    await expect(fetch("/api/todos")).rejects.toThrow("aborted");
    s.flush();
    expect(samplesOf(s.batches)).toMatchObject([{ route: "/api/todos", status: 0 }]);
  });

  it("flushes automatically at the batch cap", async () => {
    const s = sandbox();
    s.enable(["/api/todos"]);
    const fetch = s.win.fetch as (u: string) => Promise<{ status: number }>;
    for (let i = 0; i < 256; i++) await fetch("/api/todos");
    expect(s.batches.length).toBeGreaterThanOrEqual(1);
    expect(samplesOf(s.batches)).toHaveLength(256);
    expect(s.batches.every((b) => JSON.stringify(b).length < 64 * 1024)).toBe(true);
  });

  it("wraps XHR via open/send and records loadend status", async () => {
    const s = sandbox();
    s.enable(["/api/todos"]);
    const Xhr = s.win.XMLHttpRequest as typeof FakeXhr;
    const xhr = new Xhr();
    xhr.open("POST", "/api/todos");
    xhr.send();
    await new Promise((r) => setTimeout(r, 5));
    s.flush();
    expect(samplesOf(s.batches)).toMatchObject([{ route: "/api/todos", method: "POST", status: 200 }]);
  });

  it("disable restores the original fetch and stops collection", async () => {
    const s = sandbox();
    const original = s.win.fetch;
    s.enable(["/api/todos"]);
    expect(s.win.fetch).not.toBe(original);
    s.send({ source: "vv-metrics", type: "disable" });
    expect(s.win.fetch).toBe(original);
    await (s.win.fetch as (u: string) => Promise<{ status: number }>)("/api/todos");
    s.flush();
    expect(s.batches).toEqual([]);
  });

  it("ignores control messages not posted by the parent window", () => {
    const s = sandbox();
    const original = s.win.fetch;
    s.send({ source: "vv-metrics", type: "enable", token: "tok", routes: ["/api/todos"] }, {});
    expect(s.win.fetch).toBe(original);
  });

  it("is idempotent under re-injection (HMR)", async () => {
    const s = sandbox();
    s.enable(["/api/todos"]);
    const wrapped = s.win.fetch;
    s.install(); // a second injection must not double-wrap
    expect(s.win.fetch).toBe(wrapped);
    await (s.win.fetch as (u: string) => Promise<{ status: number }>)("/api/todos");
    s.flush();
    expect(samplesOf(s.batches)).toHaveLength(1);
  });
});
