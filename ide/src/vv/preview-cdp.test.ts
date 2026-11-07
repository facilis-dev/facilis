import { describe, expect, it } from "vitest";
import { PreviewCdp } from "./preview-cdp";
import type { PreviewTab } from "./preview-session";

const TAB: PreviewTab = { id: "pv1", url: "localhost:5173", port: 5173, path: "/", nonce: 1 };

interface FrontendMessage {
  source: "vv-cdp";
  dir: "frontend";
  data: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function frontend(posted: unknown[]): FrontendMessage[] {
  return posted.filter(
    (entry): entry is FrontendMessage => isRecord(entry) && entry.dir === "frontend",
  );
}

function parse(posted: unknown[], index = 0): Record<string, unknown> {
  const message = frontend(posted)[index];
  return JSON.parse(message?.data ?? "{}") as Record<string, unknown>;
}

function harness() {
  const posted: unknown[] = [];
  const frame = {
    contentWindow: { postMessage: (message: unknown) => posted.push(message) },
  };
  const cdp = new PreviewCdp({
    active: () => TAB,
    frame: (id) => (id === TAB.id ? (frame as unknown as HTMLIFrameElement) : undefined),
  });
  const target = (message: unknown) => cdp.dispatch(TAB.id, JSON.stringify(message));
  return { cdp, posted, target };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("PreviewCdp", () => {
  it("attaches with the bootstrap handshake and evaluates through Runtime.evaluate", async () => {
    const { cdp, posted, target } = harness();
    const pending = cdp.evaluate("1+1");
    await tick();
    expect(posted[0]).toEqual({ source: "vv-cdp", dir: "init" });
    // The attach probe answers, then the real expression does.
    target({ id: parse(posted).id, result: { result: { type: "number", value: 1 } } });
    await tick();
    target({ id: parse(posted, 1).id, result: { result: { type: "number", value: 2 } } });
    await expect(pending).resolves.toBe(2);
    expect(parse(posted, 1).method).toBe("Runtime.evaluate");
  });

  it("surfaces a page exception as an error", async () => {
    const { cdp, posted, target } = harness();
    const pending = cdp.evaluate("boom()");
    await tick();
    target({ id: parse(posted).id, result: { result: { type: "number", value: 1 } } });
    await tick();
    target({
      id: parse(posted, 1).id,
      result: {
        exceptionDetails: {
          text: "Uncaught ReferenceError",
          exception: { description: "boom is not defined" },
        },
      },
    });
    await expect(pending).rejects.toThrow("boom is not defined");
  });

  it("buffers console errors and exceptions per page", () => {
    const { cdp, target } = harness();
    cdp.onFrameLoad(TAB.id);
    target({
      method: "Runtime.consoleAPICalled",
      params: { type: "error", args: [{ value: "POST failed" }] },
    });
    target({
      method: "Runtime.consoleAPICalled",
      params: { type: "warning", args: [{ value: "careful" }] },
    });
    target({
      method: "Runtime.exceptionThrown",
      params: { exceptionDetails: { exception: { description: "TypeError: x" } } },
    });
    expect(cdp.consoleEntries().map((entry) => entry.kind + ":" + entry.text)).toEqual([
      "error:POST failed",
      "warn:careful",
      "exception:TypeError: x",
    ]);
  });

  it("buffers network requests with their status and failures", () => {
    const { cdp, target } = harness();
    cdp.onFrameLoad(TAB.id);
    target({
      method: "Network.requestWillBeSent",
      params: {
        requestId: "r1",
        request: { method: "POST", url: "http://localhost:5173/api/todos" },
      },
    });
    target({
      method: "Network.responseReceived",
      params: {
        requestId: "r1",
        response: { status: 500, url: "http://localhost:5173/api/todos" },
      },
    });
    target({
      method: "Network.requestWillBeSent",
      params: { requestId: "r2", request: { method: "GET", url: "http://localhost:5173/api/x" } },
    });
    target({
      method: "Network.loadingFailed",
      params: { requestId: "r2", errorText: "net::ERR_FAILED" },
    });
    expect(cdp.networkEntries()).toEqual([
      { method: "POST", url: "http://localhost:5173/api/todos", status: 500 },
      { method: "GET", url: "http://localhost:5173/api/x", error: "net::ERR_FAILED" },
    ]);
  });

  it("drops the page buffers when the frame reloads and rejects in-flight calls", async () => {
    const { cdp, posted, target } = harness();
    const pending = cdp.evaluate("1");
    await tick();
    // First the attach probe, then the real expression.
    target({ id: parse(posted).id, result: { result: { type: "number", value: 1 } } });
    await tick();
    target({ id: parse(posted, 1).id, result: { result: { type: "number", value: 1 } } });
    await expect(pending).resolves.toBe(1);
    const inFlight = cdp.evaluate("2");
    await tick();
    cdp.onFrameLoad(TAB.id);
    await expect(inFlight).rejects.toThrow("reloaded");
    expect(cdp.consoleEntries()).toEqual([]);
  });

  it("captures one screencast frame as a JPEG screenshot", async () => {
    const { cdp, posted, target } = harness();
    const pending = cdp.captureScreenshot();
    await tick();
    target({ id: parse(posted).id, result: { result: { type: "number", value: 1 } } });
    await tick();
    // The capture asks chobitsu to start the screencast, then waits for a frame.
    expect(
      frontend(posted).some(
        (message) => JSON.parse(message.data).method === "Page.startScreencast",
      ),
    ).toBe(true);
    target({
      method: "Page.screencastFrame",
      params: { data: "QUJD", metadata: { deviceWidth: 800, deviceHeight: 600 } },
    });
    await expect(pending).resolves.toEqual({ data: "QUJD", width: 800, height: 600 });
    await tick();
    expect(
      frontend(posted).some((message) => JSON.parse(message.data).method === "Page.stopScreencast"),
    ).toBe(true);
  });

  it("returns null when the page produces no frame in time", async () => {
    const { cdp, posted, target } = harness();
    const pending = cdp.captureScreenshot(30);
    await tick();
    target({ id: parse(posted).id, result: { result: { type: "number", value: 1 } } });
    await expect(pending).resolves.toBeNull();
  });

  it("reports no preview when no tab is running", async () => {
    const cdp = new PreviewCdp({ active: () => null, frame: () => undefined });
    expect(cdp.mounted()).toBe(false);
    await expect(cdp.evaluate("1")).rejects.toThrow("no preview is running");
  });
});
