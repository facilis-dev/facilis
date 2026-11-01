import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitRepoRef } from "./git-provider";
import { listRemoteTree, pushChanges, type PushChanges, type PushOptions } from "./git-push";

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const bytes = (text: string) => new TextEncoder().encode(text);

const ref: GitRepoRef = {
  provider: "github",
  api: "https://api.github.com",
  owner: "acme",
  repo: "site",
};

function options(overrides: Partial<PushOptions> = {}): PushOptions {
  return {
    ref,
    token: "ghp_secret",
    branch: "main",
    headSha: "head1",
    message: "Publish",
    changes: {
      added: [{ path: "src/app.ts", bytes: bytes("app") }],
      modified: [],
      deleted: [],
    },
    identity: { name: "Ada", email: "ada@example.com" },
    ...overrides,
  };
}

/** The guard only reads byteLength; a real 40 MB array would just waste the heap. */
function file(path: string, byteLength: number) {
  return { path, bytes: { byteLength } as unknown as Uint8Array };
}

describe("pushChanges guards", () => {
  it("refuses an empty change set before touching the network", async () => {
    const changes: PushChanges = { added: [], modified: [], deleted: [] };
    await expect(pushChanges(options({ changes }))).rejects.toThrow("Nothing to push.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names the file that is over the 40 MB API limit", async () => {
    await expect(
      pushChanges(
        options({
          changes: {
            added: [file("assets/big.iso", 40 * 1024 * 1024 + 1)],
            modified: [],
            deleted: [],
          },
        }),
      ),
    ).rejects.toThrow(/assets\/big\.iso is too large to push through the API \(40 MB limit\)/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a change set over the 200 MB total limit", async () => {
    // Six files under the per-file cap can still exceed the per-push one.
    const each = 34 * 1024 * 1024;
    const changes: PushChanges = {
      added: Array.from({ length: 6 }, (_, index) => file("part-" + index + ".bin", each)),
      modified: [],
      deleted: [],
    };
    await expect(pushChanges(options({ changes }))).rejects.toThrow(/200 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets a file exactly at the limit reach the host", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "unauthorized" }, 401));
    await expect(
      pushChanges(
        options({
          changes: { added: [file("a.bin", 40 * 1024 * 1024)], modified: [], deleted: [] },
        }),
      ),
    ).rejects.toThrow(/rejected the token/);
  });
});

const providers: { provider: GitRepoRef["provider"]; api: string; host: string }[] = [
  { provider: "github", api: "https://api.github.com", host: "GitHub" },
  { provider: "gitlab", api: "https://gitlab.com/api/v4", host: "GitLab" },
  { provider: "gitea", api: "https://gitea.example.com/api/v1", host: "Gitea" },
];

describe("host dispatch", () => {
  it("pushes through the adapter of the ref's provider", async () => {
    for (const { provider, api, host } of providers) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(json({ message: "nope" }, 401));
      await expect(
        pushChanges(options({ ref: { provider, api, owner: "acme", repo: "site" } })),
      ).rejects.toThrow(new RegExp(host + " rejected the token"));
      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).toContain(api);
      expect(url).not.toContain("ghp_secret");
    }
  });

  it("lists through the adapter of the ref's provider", async () => {
    for (const { provider, api, host } of providers) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(json({ message: "nope" }, 401));
      await expect(
        listRemoteTree({ provider, api, owner: "acme", repo: "site" }, "tok"),
      ).rejects.toThrow(new RegExp(host + " rejected the token"));
      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).toContain(api);
      expect(url).not.toContain("tok");
    }
  });
});
