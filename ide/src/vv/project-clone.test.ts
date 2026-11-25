// The clone flow's contract with the import dialog (D-208): a proxy that demands
// a token must surface a dedicated message and THROW (the dialog stays open on
// the token field), while any other clone failure returns false so the dialog
// can fall back to the REST importer. Only git-remote and the toast are stubbed;
// the error detection and the i18n copy are the production code paths.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { initI18n, setLocale } from "@/i18n";
import type { KernelBridge } from "./kernel";
import { cloneIntoProject } from "./project-clone";
import type { ProjectImportHost } from "./project-import";

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn(), loading: vi.fn() },
}));

const cloneRepo = vi.hoisted(() => vi.fn());
vi.mock("./git-remote", () => ({
  cloneRepo,
  probeProxy: vi.fn(async () => true),
  proxyBase: vi.fn(() => "https://app.example.com/git-proxy"),
}));

initI18n();

const bridge = {
  request: vi.fn(async () => ({ ok: true })),
  post: vi.fn(),
} as unknown as KernelBridge;

const host = {
  kernelReady: () => true,
  slug: (name: string) => name,
  defaultDirFor: (base: string) => "/w/" + base,
  validateNewDir: async () => false,
} as unknown as ProjectImportHost;

const URL = "https://github.com/owner/repo.git";

function httpError(response: string): Error {
  // isomorphic-git's HttpError shape: code plus data.statusCode/data.response.
  return Object.assign(new Error("HTTP Error: 401 Unauthorized"), {
    code: "HttpError",
    data: { statusCode: 401, statusMessage: "Unauthorized", response },
  });
}

/** The shape guarded() leaves behind: a wrapper over the original HttpError. */
function wrapped(response: string): Error {
  return new Error("HTTP Error: 401 Unauthorized", { cause: httpError(response) });
}

beforeEach(() => {
  vi.clearAllMocks();
  setLocale("en");
});

describe("cloneIntoProject and the proxy's token requirement (D-208)", () => {
  it("throws with the dedicated message instead of falling back", async () => {
    cloneRepo.mockRejectedValueOnce(wrapped("authorization required"));
    await expect(cloneIntoProject(bridge, host, URL)).rejects.toThrow(
      "This installation's git proxy requires a token for every repository, including public ones. Add an access token below and try again.",
    );
    expect(toast.error).toHaveBeenCalledWith("Access token required", {
      description:
        "This installation's git proxy requires a token for every repository, including public ones. Add an access token below and try again.",
    });
  });

  it("speaks Italian when the locale is it", async () => {
    setLocale("it");
    cloneRepo.mockRejectedValueOnce(wrapped("authorization required"));
    await expect(cloneIntoProject(bridge, host, URL)).rejects.toThrow(
      "Il proxy git di questa installazione richiede un token",
    );
  });

  it("still returns false on other clone failures, keeping the REST fallback", async () => {
    cloneRepo.mockRejectedValueOnce(new Error("boom"));
    await expect(cloneIntoProject(bridge, host, URL)).resolves.toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Clone failed: boom");
  });

  it("does not treat a host's own 401 as the proxy's token requirement", async () => {
    cloneRepo.mockRejectedValueOnce(wrapped("Bad credentials"));
    await expect(cloneIntoProject(bridge, host, URL)).resolves.toBe(false);
  });
});
