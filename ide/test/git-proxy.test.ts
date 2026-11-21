import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createGitProxy,
  DEFAULT_ALLOWED_HOSTS,
  parseAllowedHosts,
  parseOrigins,
  parseRequireAuth,
} from "../git-proxy/handler.mjs";

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

function okResponse(): Response {
  return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
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

  it("answers a same-origin preflight by echoing that origin, and calls no upstream", async () => {
    const { calls, proxy } = proxyFor(() => new Response("unexpected"));
    const response = await proxy.fetch(
      new Request(`${BASE}/github.com/owner/repo.git/info/refs`, {
        method: "OPTIONS",
        headers: { origin: "https://ide.facilis.dev" },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://ide.facilis.dev");
    expect(response.headers.get("vary")).toBe("origin");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, HEAD, POST, OPTIONS");
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
    // No Origin header, so there is no browser to answer: no CORS headers at all.
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
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

describe("caller controls (D-208)", () => {
  it("refuses a browser from another origin without contacting upstream", async () => {
    const { calls, proxy } = proxyFor(() => new Response("unexpected"));
    const response = await proxy.fetch(
      new Request(`${BASE}/github.com/owner/repo.git/info/refs`, {
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("origin not allowed");
    // No CORS headers: the foreign page cannot even read the refusal.
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("treats the opaque 'null' origin as foreign", async () => {
    const { calls, proxy } = proxyFor(() => new Response("unexpected"));
    const response = await proxy.fetch(
      new Request(`${BASE}/github.com/owner/repo.git/info/refs`, { headers: { origin: "null" } }),
    );
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("accepts the deployment's own host whatever the scheme (TLS-terminating proxy)", async () => {
    const { calls, proxy } = proxyFor(okResponse);
    const response = await proxy.fetch(
      new Request(`${BASE}/github.com/owner/repo.git/info/refs`, {
        headers: { origin: "http://ide.facilis.dev" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://ide.facilis.dev");
    expect(calls).toHaveLength(1);
  });

  it("accepts an origin the operator names, and only that one", async () => {
    const recorder = recordingFetch(okResponse);
    const proxy = createGitProxy({
      allow: ["github.com"],
      allowedOrigins: ["https://ide.acme.example"],
      fetchImpl: recorder.fetchImpl,
    });
    const allowed = await proxy.fetch(
      new Request(`${BASE}/github.com/owner/repo.git/info/refs`, {
        headers: { origin: "https://ide.acme.example" },
      }),
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://ide.acme.example");

    const other = await proxy.fetch(
      new Request(`${BASE}/github.com/owner/repo.git/info/refs`, {
        headers: { origin: "https://other.acme.example" },
      }),
    );
    expect(other.status).toBe(403);
    expect(recorder.calls).toHaveLength(1);
  });

  it("requires a token on git traffic, and never on the login that produces it", async () => {
    const recorder = recordingFetch(okResponse);
    const proxy = createGitProxy({
      allow: ["github.com"],
      requireAuthorization: true,
      fetchImpl: recorder.fetchImpl,
    });

    const anonymous = await proxy.fetch(
      new Request(`${BASE}/github.com/owner/repo.git/info/refs?service=git-upload-pack`),
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toBe('Basic realm="git-proxy"');
    expect(recorder.calls).toHaveLength(0);

    const deniedPush = await proxy.fetch(
      new Request(`${BASE}/github.com/owner/repo.git/git-receive-pack`, { method: "POST" }),
    );
    expect(deniedPush.status).toBe(401);

    // The preflight carries no Authorization header, so it must not be refused.
    const preflight = await proxy.fetch(
      new Request(`${BASE}/github.com/owner/repo.git/git-upload-pack`, {
        method: "OPTIONS",
        headers: { origin: "https://ide.facilis.dev" },
      }),
    );
    expect(preflight.status).toBe(204);

    const authenticated = await proxy.fetch(
      new Request(`${BASE}/github.com/owner/repo.git/git-upload-pack`, {
        method: "POST",
        headers: { authorization: "Basic x-access-token:secret" },
      }),
    );
    expect(authenticated.status).toBe(200);

    const login = await proxy.fetch(
      new Request(`${BASE}/github.com/login/device/code`, { method: "POST" }),
    );
    expect(login.status).toBe(200);
    expect(recorder.calls).toHaveLength(2);
  });
});

describe("parseOrigins", () => {
  it("normalizes, deduplicates and drops everything that is not an origin", () => {
    const raw =
      " HTTPS://Ide.Acme.Example , https://ide.acme.example, https://ide.acme.example:8443/, *, null, not a url";
    expect(parseOrigins(raw)).toEqual([
      "https://ide.acme.example",
      "https://ide.acme.example:8443",
    ]);
  });

  it("is empty for empty input: there is no 'any origin'", () => {
    expect(parseOrigins()).toEqual([]);
    expect(parseOrigins("")).toEqual([]);
    expect(parseOrigins("*")).toEqual([]);
  });
});

describe("parseRequireAuth", () => {
  it("turns on only for an explicit positive", () => {
    for (const on of ["1", "true", "TRUE", "yes", "on"]) expect(parseRequireAuth(on)).toBe(true);
    for (const off of ["", "0", "false", "no", "off", "nope"]) {
      expect(parseRequireAuth(off)).toBe(false);
    }
    expect(parseRequireAuth()).toBe(false);
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
