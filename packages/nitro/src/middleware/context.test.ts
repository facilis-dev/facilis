import type { H3Event } from "nitro";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOGGING_CONFIG,
  NOOP_LOGGING_API,
  createAccessEntry,
  defineConfig,
  type FacilisEventContext,
} from "@facilis/core";

import type { BootstrapState } from "../runtime/bootstrap.ts";
import type { ResolvedLogSettings } from "../runtime/logging/log-settings.ts";
import { DEFAULT_LOG_KEEP, DEFAULT_LOG_MAX_BYTES } from "../runtime/logging/log-settings.ts";
import { createLoggingRuntime } from "../runtime/logging/runtime.ts";

const bootstrapMock = vi.hoisted(() => ({ getBootstrap: vi.fn() }));

vi.mock("../runtime/bootstrap.ts", () => ({ getBootstrap: bootstrapMock.getBootstrap }));

import handler, { firstForwardedFor } from "./context.ts";

const DB = { driver: "pglite" } as unknown as BootstrapState["db"];
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

function state(overrides: Partial<BootstrapState> = {}): BootstrapState {
  return {
    db: DB,
    config: null,
    warnings: [],
    startedAt: "2026-11-08T12:00:00.000Z",
    jobs: null,
    storage: null,
    logging: NOOP_LOGGING_API,
    loggingConfig: DEFAULT_LOGGING_CONFIG,
    ...overrides,
  };
}

interface Harness {
  readonly event: H3Event;
  readonly response: Response;
  readonly context: FacilisEventContext;
}

function makeEvent(headers: Record<string, string> = {}): Harness {
  const request = new Request("http://localhost/api/items?token=secret", { headers });
  const response = new Response(null);
  const event = { req: request, res: response, context: {} } as unknown as H3Event;
  const context = (event as unknown as { context: FacilisEventContext }).context;
  return { event, response, context };
}

function stdoutSettings(): ResolvedLogSettings {
  return {
    mode: "stdout",
    sinks: { stdout: true, file: false },
    dir: "/tmp/facilis-logs-unused",
    maxBytes: DEFAULT_LOG_MAX_BYTES,
    keep: DEFAULT_LOG_KEEP,
    level: null,
  };
}

beforeEach(() => {
  bootstrapMock.getBootstrap.mockReset();
});

describe("facilis-context middleware", () => {
  it("attaches logging, the request id and the client to the facade", async () => {
    bootstrapMock.getBootstrap.mockResolvedValue(state());
    const harness = makeEvent();

    await handler(harness.event);

    const requestId = harness.context.facilis?.requestId;
    expect(requestId).toMatch(REQUEST_ID_PATTERN);
    expect(harness.response.headers.get("x-request-id")).toBe(requestId);
    expect(harness.context.facilis?.logging).toBe(NOOP_LOGGING_API);
    expect(harness.context.facilis?.db).toBe(DB);
    expect(harness.context.facilis?.defaultTenantId).toEqual(expect.any(String));
    expect(harness.context.facilis?.client).toBeUndefined();
    // The CSRF gate needs an allow-list on every request, config default included.
    expect(harness.context.security).toEqual({ trustedOrigins: [] });
  });

  it("echoes a valid inbound x-request-id", async () => {
    bootstrapMock.getBootstrap.mockResolvedValue(state());
    const harness = makeEvent({ "x-request-id": "request-abc123" });

    await handler(harness.event);

    expect(harness.context.facilis?.requestId).toBe("request-abc123");
    expect(harness.response.headers.get("x-request-id")).toBe("request-abc123");
  });

  it.each(["short", "bad id spaces", "x".repeat(200)])(
    "generates an id instead of accepting %s",
    async (inbound) => {
      bootstrapMock.getBootstrap.mockResolvedValue(state());
      const harness = makeEvent({ "x-request-id": inbound });

      await handler(harness.event);

      const requestId = harness.context.facilis?.requestId;
      expect(requestId).not.toBe(inbound);
      expect(requestId).toMatch(REQUEST_ID_PATTERN);
    },
  );

  it("collects client metadata only when the config opts in", async () => {
    bootstrapMock.getBootstrap.mockResolvedValue(state());
    const headers = {
      "user-agent": "test-agent/1.0",
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    };
    const harness = makeEvent(headers);

    await handler(harness.event);

    expect(harness.context.facilis?.client).toBeUndefined();
  });

  it("collects the User-Agent when includeUserAgent is on", async () => {
    bootstrapMock.getBootstrap.mockResolvedValue(
      state({ loggingConfig: { ...DEFAULT_LOGGING_CONFIG, includeUserAgent: true } }),
    );
    const harness = makeEvent({ "user-agent": "test-agent/1.0", "x-forwarded-for": "10.0.0.1" });

    await handler(harness.event);

    expect(harness.context.facilis?.client).toEqual({ userAgent: "test-agent/1.0" });
  });

  it("takes the first x-forwarded-for value only behind a trusted proxy", async () => {
    bootstrapMock.getBootstrap.mockResolvedValue(
      state({ loggingConfig: { ...DEFAULT_LOGGING_CONFIG, trustProxy: true } }),
    );
    const harness = makeEvent({
      "user-agent": "test-agent/1.0",
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    });

    await handler(harness.event);

    expect(harness.context.facilis?.client).toEqual({ ip: "203.0.113.7" });
  });

  it("caps a 10 000-character x-forwarded-for before the log line is written", async () => {
    const lines: string[] = [];
    const logging = createLoggingRuntime({
      config: { ...DEFAULT_LOGGING_CONFIG, trustProxy: true },
      settings: stdoutSettings(),
      writeStdout: (line) => lines.push(line),
    });
    bootstrapMock.getBootstrap.mockResolvedValue(
      state({
        logging,
        loggingConfig: { ...DEFAULT_LOGGING_CONFIG, trustProxy: true },
      }),
    );
    const harness = makeEvent({ "x-forwarded-for": `${"9".repeat(10_000)}, 10.0.0.1` });

    await handler(harness.event);

    const facade = harness.context.facilis;
    if (facade === undefined) throw new Error("expected the facilis facade to be attached");
    const ip = facade.client?.ip;
    expect(ip).toHaveLength(10_000);
    logging.record(
      createAccessEntry(
        {
          requestId: facade.requestId ?? "request-12345678",
          method: "GET",
          path: "/api/items",
          ...(ip === undefined ? {} : { ip }),
        },
        { status: 200, durationMs: 1 },
      ),
    );

    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry["ip"]).toHaveLength(200);
  });

  it("passes the config trusted origins to context.security", async () => {
    bootstrapMock.getBootstrap.mockResolvedValue(
      state({
        config: defineConfig({
          auth: { defaultRole: "user", roles: { user: [] } },
          security: { trustedOrigins: ["https://app.example.com"] },
        }),
      }),
    );
    const harness = makeEvent();

    await handler(harness.event);

    expect(harness.context.security).toEqual({ trustedOrigins: ["https://app.example.com"] });
  });

  it("keeps the response id when the db never booted but leaves the facade unset", async () => {
    bootstrapMock.getBootstrap.mockResolvedValue(state({ db: null }));
    const harness = makeEvent();

    await handler(harness.event);

    expect(harness.context.facilis).toBeUndefined();
    // The origin gate is structural: it applies even when the rest of the facade is absent.
    expect(harness.context.security).toEqual({ trustedOrigins: [] });
    expect(harness.response.headers.get("x-request-id")).toMatch(REQUEST_ID_PATTERN);
  });
});

describe("firstForwardedFor", () => {
  it("returns the first trimmed address", () => {
    expect(firstForwardedFor("203.0.113.7, 10.0.0.1")).toBe("203.0.113.7");
    expect(firstForwardedFor(" 203.0.113.7 ")).toBe("203.0.113.7");
  });

  it("returns undefined for a missing or blank header", () => {
    expect(firstForwardedFor(undefined)).toBeUndefined();
    expect(firstForwardedFor("   ")).toBeUndefined();
  });
});
