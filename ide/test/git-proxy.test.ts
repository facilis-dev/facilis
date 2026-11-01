import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createGitProxy, DEFAULT_ALLOWED_HOSTS, parseAllowedHosts } from "../git-proxy/handler.mjs";

const BASE = "https://ide.facilis.dev/git-proxy";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function recordingFetch(respond: (call: RecordedCall) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call);
  };
  return { calls, fetchImpl };
}

function proxyFor(respond: (call: RecordedCall) => Response | Promise<Response>) {
  const recorder = recordingFetch(respond);
  const proxy = createGitProxy({ allow: ["github.com"], fetchImpl: recorder.fetchImpl });
  return { ...recorder, proxy };
}

describe("git proxy handler", () => {
  it("answers the health probe with 204 and never contacts upstream", async () => {
    const { calls, proxy } = proxyFor(() => new Response("unexpected"));
    const response = await proxy.fetch(new Request(`${BASE}/health`));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(calls).toHaveLength(0);
  });

  it("forwards method, path, query and only the allowlisted request headers", async () => {
    const upstream = new Response("refs", {
      status: 200,
      headers: { "content-type": "application/x-git-upload-pack-advertisement" },
    });
    const { calls, proxy } = proxyFor(() => upstream);
    const request = new Request(
      `${BASE}/GitHub.com/owner/repo.git/info/refs?service=git-upload-pack`,
      {
        headers: {
          authorization: "Bearer secret-token",
          "content-type": "application/x-git-upload-pack-request",
          accept: "application/x-git-upload-pack-result",
          "user-agent": "git/2.45.0",
          "git-protocol": "version=2",
          origin: "https://ide.facilis.dev",
          referer: "https://ide.facilis.dev/",
          cookie: "session=secret",
          "accept-encoding": "gzip, br",
          "x-forwarded-for": "203.0.113.7",
        },
      },
    );

    const response = await proxy.fetch(request);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe("https://github.com/owner/repo.git/info/refs?service=git-upload-pack");
    expect(call?.init.method).toBe("GET");
    expect(call?.init.body ?? null).toBeNull();

    const forwarded = new Headers(call?.init.headers);
    expect([...forwarded.keys()].toSorted()).toEqual(
      ["accept", "authorization", "content-type", "git-protocol", "user-agent"].toSorted(),
    );
    expect(forwarded.get("authorization")).toBe("Bearer secret-token");
    expect(forwarded.get("content-type")).toBe("application/x-git-upload-pack-request");
    expect(forwarded.get("accept")).toBe("application/x-git-upload-pack-result");
    expect(forwarded.get("user-agent")).toBe("git/2.45.0");
    expect(forwarded.get("git-protocol")).toBe("version=2");
    for (const dropped of [
      "origin",
      "referer",
      "cookie",
      "accept-encoding",
      "x-forwarded-for",
      "host",
    ]) {
      expect(forwarded.get(dropped)).toBeNull();
    }
  });

  it("forwards an allowlisted host:port without dropping the port", async () => {
    const recorder = recordingFetch(() => new Response("ok", { status: 200 }));
    const proxy = createGitProxy({
      allow: ["gitea.com:8443"],
      fetchImpl: recorder.fetchImpl,
    });
    const response = await proxy.fetch(
      new Request(`${BASE}/gitea.com:8443/owner/repo.git/info/refs`),
    );
    expect(response.status).toBe(200);
    expect(recorder.calls[0]?.url).toBe("https://gitea.com:8443/owner/repo.git/info/refs");
  });

  it("refuses a host outside the allowlist without contacting upstream", async () => {
    const { calls, proxy } = proxyFor(() => new Response("unexpected"));
    const hosts = ["evil.example", "github.com.evil.example", "github.com@evil.example"];
    const results = await Promise.all(
      hosts.map(async (host) => {
        const response = await proxy.fetch(new Request(`${BASE}/${host}/owner/repo.git/info/refs`));
        return {
          status: response.status,
          contentType: response.headers.get("content-type"),
          body: await response.text(),
        };
      }),
    );
    for (const result of results) {
      expect(result.status).toBe(403);
      expect(result.contentType).toBe("text/plain");
      expect(result.body).toBe("host not allowed");
    }
    expect(calls).toHaveLength(0);
  });

  it("answers OPTIONS with the preflight headers and no upstream call", async () => {
    const { calls, proxy } = proxyFor(() => new Response("unexpected"));
    const response = await proxy.fetch(
      new Request(`${BASE}/github.com/owner/repo.git/info/refs`, { method: "OPTIONS" }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "authorization, content-type, accept, user-agent, git-protocol",
    );
    expect(response.headers.get("access-control-expose-headers")).toBe("content-type");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(calls).toHaveLength(0);
  });

  it("maps an upstream failure to an opaque 502", async () => {
    const { proxy } = proxyFor(() => {
      throw new Error("ECONNREFUSED 10.0.0.5 secret-token");
    });
    const response = await proxy.fetch(
      new Request(`${BASE}/github.com/owner/repo.git/info/refs?service=git-upload-pack`),
    );
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toBe("text/plain");
    const body = await response.text();
    expect(body).toBe("git proxy: upstream request failed");
    expect(body).not.toContain("secret-token");
  });

  it("copies status and content-type while stripping upstream headers", async () => {
    const upstream = new Response("pack", {
      status: 200,
      headers: {
        "content-type": "application/x-git-upload-pack-result",
        "set-cookie": "session=upstream-secret",
        "content-encoding": "gzip",
        "content-length": "4",
        "transfer-encoding": "chunked",
        "cache-control": "public, max-age=3600",
        "x-upstream": "secret",
      },
    });
    const { proxy } = proxyFor(() => upstream);
    const response = await proxy.fetch(
      new Request(`${BASE}/github.com/owner/repo.git/git-upload-pack`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-git-upload-pack-result");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    for (const stripped of [
      "set-cookie",
      "content-encoding",
      "content-length",
      "transfer-encoding",
      "x-upstream",
    ]) {
      expect(response.headers.get(stripped)).toBeNull();
    }
    expect(await response.text()).toBe("pack");
  });

  it("streams a 1 MB request body through untouched", async () => {
    const payload = new Uint8Array(1024 * 1024);
    for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251;
    const expected = createHash("sha256").update(payload).digest("hex");
    let received = "";
    const { calls, proxy } = proxyFor(async ({ init }) => {
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
      received = createHash("sha256").update(bytes).digest("hex");
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    });

    const response = await proxy.fetch(
      new Request(`${BASE}/github.com/owner/repo.git/git-upload-pack`, {
        method: "POST",
        body: payload,
        headers: { "content-type": "application/x-git-upload-pack-request" },
      }),
    );

    expect(response.status).toBe(200);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.duplex).toBe("half");
    expect(received).toBe(expected);
  });

  it("rejects methods other than GET, HEAD, POST and OPTIONS", async () => {
    const { calls, proxy } = proxyFor(() => new Response("unexpected"));
    const response = await proxy.fetch(
      new Request(`${BASE}/github.com/owner/repo.git/info/refs`, { method: "DELETE" }),
    );
    expect(response.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it("never writes to the console during a forwarded request", async () => {
    const methods = ["log", "warn", "error", "info", "debug"] as const;
    const spies = methods.map((name) => vi.spyOn(console, name));
    try {
      const { proxy } = proxyFor(
        () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
      );
      const response = await proxy.fetch(
        new Request(`${BASE}/github.com/owner/repo.git/info/refs?service=git-upload-pack`),
      );
      expect(response.status).toBe(200);
      await response.text();
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("parseAllowedHosts", () => {
  it("falls back to the public defaults for empty or all-junk input", () => {
    expect(parseAllowedHosts()).toEqual(DEFAULT_ALLOWED_HOSTS);
    expect(parseAllowedHosts("")).toEqual(DEFAULT_ALLOWED_HOSTS);
    expect(parseAllowedHosts(" , ")).toEqual(DEFAULT_ALLOWED_HOSTS);
    expect(parseAllowedHosts("bad/host, has space.example")).toEqual(DEFAULT_ALLOWED_HOSTS);
  });

  it("normalizes case, https://, whitespace and host:port", () => {
    expect(parseAllowedHosts(" GitHub.COM , https://Git.Acme.Example , gitea.com:8443 ")).toEqual([
      "github.com",
      "git.acme.example",
      "gitea.com:8443",
    ]);
  });

  it("drops junk entries while keeping the valid ones", () => {
    expect(parseAllowedHosts("bad/host, has space.example, https://, github.com")).toEqual([
      "github.com",
    ]);
  });

  it("never accepts a wildcard entry", () => {
    expect(parseAllowedHosts("*")).toEqual(DEFAULT_ALLOWED_HOSTS);
    expect(parseAllowedHosts("github.com, *")).toEqual(["github.com"]);
  });
});
