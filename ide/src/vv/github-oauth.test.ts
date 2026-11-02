import { describe, expect, it, vi } from "vitest";
import {
  GitHubOAuthError,
  githubSessionToken,
  setGitHubSessionToken,
  signInWithGitHub,
} from "./github-oauth";

const BASE = "https://ide.example/git-proxy/";

const DEVICE = {
  device_code: "device-secret",
  user_code: "ABCD-1234",
  verification_uri: "https://github.com/login/device",
  expires_in: 900,
  interval: 1,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Call {
  url: string;
  body: URLSearchParams;
}

function fetchScript(responses: (() => Response)[]): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: new URLSearchParams(String(init?.body ?? "")),
    });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return response();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** The session token is memory only: nothing here touches storage. */
describe("GitHub device flow", () => {
  it("requests a code and polls until the token arrives", async () => {
    const { fetchImpl, calls } = fetchScript([
      () => json(DEVICE),
      () => json({ error: "authorization_pending" }),
      () => json({ access_token: "gho_test" }),
    ]);
    const onCode = vi.fn();
    const token = await signInWithGitHub({
      base: BASE,
      clientId: "Iv1.facilis",
      onCode,
      fetchImpl,
      sleepImpl: async () => {},
    });
    expect(token).toBe("gho_test");
    expect(onCode).toHaveBeenCalledWith({
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
    });
    expect(calls.map((call) => call.url)).toEqual([
      BASE + "github.com/login/device/code",
      BASE + "github.com/login/oauth/access_token",
      BASE + "github.com/login/oauth/access_token",
    ]);
    expect(calls[0].body.get("client_id")).toBe("Iv1.facilis");
    expect(calls[0].body.get("scope")).toBe("repo");
    expect(calls[1].body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
    expect(calls[1].body.get("device_code")).toBe("device-secret");
  });

  it("waits longer when GitHub says slow_down", async () => {
    const sleeps: number[] = [];
    const { fetchImpl } = fetchScript([
      () => json(DEVICE),
      () => json({ error: "authorization_pending" }),
      () => json({ error: "slow_down" }),
      () => json({ access_token: "gho_slow" }),
    ]);
    await signInWithGitHub({
      base: BASE,
      clientId: "Iv1.facilis",
      onCode: () => {},
      fetchImpl,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(sleeps).toEqual([1000, 1000, 6000]);
  });

  it("maps the terminal errors to codes, without leaking the device code", async () => {
    const run = async (error: string) => {
      const { fetchImpl } = fetchScript([() => json(DEVICE), () => json({ error })]);
      try {
        await signInWithGitHub({
          base: BASE,
          clientId: "Iv1.facilis",
          onCode: () => {},
          fetchImpl,
          sleepImpl: async () => {},
        });
        return null;
      } catch (caught) {
        return caught as GitHubOAuthError;
      }
    };
    for (const [error, code] of [
      ["expired_token", "expired"],
      ["access_denied", "denied"],
      ["bad_verification_code", "invalid"],
    ] as const) {
      const caught = await run(error);
      expect(caught?.code).toBe(code);
      expect(caught?.message).not.toContain("device-secret");
    }
  });

  it("refuses an unexpected verification page and falls back to GitHub", async () => {
    const { fetchImpl } = fetchScript([
      () => json({ ...DEVICE, verification_uri: "https://evil.example/device" }),
      () => json({ access_token: "gho_uri" }),
    ]);
    const onCode = vi.fn();
    await signInWithGitHub({
      base: BASE,
      clientId: "Iv1.facilis",
      onCode,
      fetchImpl,
      sleepImpl: async () => {},
    });
    expect(onCode).toHaveBeenCalledWith({
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
    });
  });

  it("reads a form-encoded token response too", async () => {
    const { fetchImpl } = fetchScript([
      () => json(DEVICE),
      () =>
        new Response("access_token=gho_form&token_type=bearer", {
          headers: { "content-type": "application/x-www-form-urlencoded" },
        }),
    ]);
    const token = await signInWithGitHub({
      base: BASE,
      clientId: "Iv1.facilis",
      onCode: () => {},
      fetchImpl,
      sleepImpl: async () => {},
    });
    expect(token).toBe("gho_form");
  });

  it("rejects a malformed device response and an unusable proxy base", async () => {
    const { fetchImpl } = fetchScript([() => json({})]);
    await expect(
      signInWithGitHub({
        base: BASE,
        clientId: "Iv1.facilis",
        onCode: () => {},
        fetchImpl,
        sleepImpl: async () => {},
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      signInWithGitHub({
        base: "not a url",
        clientId: "Iv1.facilis",
        onCode: () => {},
        fetchImpl,
        sleepImpl: async () => {},
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("reports network failures, an aborted wait, and a token with spaces", async () => {
    const failing = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    await expect(
      signInWithGitHub({
        base: BASE,
        clientId: "Iv1.facilis",
        onCode: () => {},
        fetchImpl: failing,
      }),
    ).rejects.toMatchObject({ code: "network" });

    const controller = new AbortController();
    const { fetchImpl } = fetchScript([() => json(DEVICE)]);
    await expect(
      signInWithGitHub({
        base: BASE,
        clientId: "Iv1.facilis",
        onCode: () => {},
        fetchImpl,
        signal: controller.signal,
        sleepImpl: async () => {
          controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: "cancelled" });

    const spaces = fetchScript([() => json(DEVICE), () => json({ access_token: "bad token" })]);
    await expect(
      signInWithGitHub({
        base: BASE,
        clientId: "Iv1.facilis",
        onCode: () => {},
        fetchImpl: spaces.fetchImpl,
        sleepImpl: async () => {},
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("keeps the session token in memory only", () => {
    expect(githubSessionToken()).toBeNull();
    setGitHubSessionToken("gho_memory");
    expect(githubSessionToken()).toBe("gho_memory");
    setGitHubSessionToken(null);
    expect(githubSessionToken()).toBeNull();
  });
});
