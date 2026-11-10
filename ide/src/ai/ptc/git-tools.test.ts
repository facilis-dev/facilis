import { describe, expect, it } from "vitest";
import { analyzeHostFiles } from "../analysis-fixtures";
import type { GitAccess } from "../git-access";
import type { PatchValidationHost } from "../patch-validation";
import { isPtcToolError, type PtcJson } from "./protocol";
import { createToolRouter } from "./tools";

const FILES = () => ["facilis.config.ts", "src/App.tsx"];
const READ = async (path: string) =>
  path === "src/App.tsx" ? "export const App = () => null;\n" : "";

function host(git: GitAccess | undefined): PatchValidationHost {
  const files = FILES;
  const read = READ;
  return {
    files,
    read,
    manifestBase: () => null,
    syntaxChecker: () => ({ check: async () => [] }),
    analyze: (patches) => analyzeHostFiles(files(), read, patches),
    ...(git === undefined ? {} : { git }),
  };
}

interface Recorded {
  tool: string;
  args: unknown[];
}

/** A GitAccess whose every method records its call and resolves a fixed JSON value. */
function recordingAccess(available = true): { access: GitAccess; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const record =
    (tool: string, result: PtcJson): ((...args: unknown[]) => Promise<PtcJson>) =>
    async (...args) => {
      calls.push({ tool, args });
      return result;
    };
  const access: GitAccess = {
    available: () => available,
    status: record("status", { branch: "main", staged: [], changes: [] }),
    diff: record("diff", { diff: "" }),
    log: record("log", { commits: [] }),
    branches: record("branches", { current: "main", branches: [] }),
    remote: record("remote", { remote: null }),
    stage: record("stage", { ok: true }),
    unstage: record("unstage", { ok: true }),
    commit: record("commit", { ok: true }),
    branch: record("branch", { ok: true }),
    sync: record("sync", { ok: true }),
    pullRequest: record("pullRequest", { ok: true }),
  };
  return { access, calls };
}

async function call(name: string, args: unknown, git: GitAccess | undefined): Promise<PtcJson> {
  return createToolRouter(host(git)).execute({ name, args }, {});
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (isPtcToolError(error)) return error;
    throw error;
  }
  throw new Error("expected the tool call to be refused");
}

describe("git tool advertisement", () => {
  it("registers the git family only when the host has a GitAccess", () => {
    const withGit = createToolRouter(host(recordingAccess().access))
      .specs()
      .map((spec) => spec.name);
    const without = createToolRouter(host(undefined))
      .specs()
      .map((spec) => spec.name);
    expect(withGit).toHaveLength(20);
    expect(withGit).toContain("git_status");
    expect(withGit).toContain("git_pull_request");
    expect(without).not.toContain("git_status");
    for (const name of withGit.filter((entry) => entry.startsWith("git_"))) {
      expect(withGit).toContain(name);
    }
  });

  it("refuses a git call when the host has no git seam", async () => {
    const error = await refusal(call("git_status", {}, undefined));
    expect(error.message).toContain("not implemented");
  });
});

describe("git tool dispatch", () => {
  it("forwards every argument to the matching GitAccess method", async () => {
    const { access, calls } = recordingAccess();
    await call("git_status", {}, access);
    await call("git_diff", { path: "src/App.tsx", staged: true }, access);
    await call("git_log", {}, access);
    await call("git_log", { limit: 5 }, access);
    await call("git_branches", {}, access);
    await call("git_remote", {}, access);
    await call("git_stage", { paths: ["src/a.ts", "db/b.ts"] }, access);
    await call("git_unstage", {}, access);
    await call("git_unstage", { paths: ["src/a.ts"] }, access);
    await call("git_commit", { message: "feat: add x" }, access);
    await call("git_branch", { action: "create", name: "feature/x" }, access);
    await call("git_sync", { action: "pull" }, access);
    await call("git_pull_request", { title: "Add x", body: "why", draft: true }, access);
    expect(calls).toContainEqual({ tool: "diff", args: [{ path: "src/App.tsx", staged: true }] });
    expect(calls).toContainEqual({ tool: "log", args: [undefined] });
    expect(calls).toContainEqual({ tool: "log", args: [5] });
    expect(calls).toContainEqual({ tool: "stage", args: [["src/a.ts", "db/b.ts"]] });
    expect(calls).toContainEqual({ tool: "unstage", args: [] });
    expect(calls).toContainEqual({ tool: "commit", args: ["feat: add x"] });
    expect(calls).toContainEqual({ tool: "branch", args: ["create", "feature/x"] });
    expect(calls).toContainEqual({ tool: "sync", args: ["pull"] });
    expect(calls).toContainEqual({
      tool: "pullRequest",
      args: [{ title: "Add x", body: "why", draft: true }],
    });
  });

  it("reports an unavailable GitAccess as data, never as an exception", async () => {
    const { access } = recordingAccess(false);
    expect(await call("git_status", {}, access)).toMatchObject({ available: false });
    expect(await call("git_sync", { action: "push" }, access)).toMatchObject({
      available: false,
    });
  });
});

describe("git tool argument validation", () => {
  it("never accepts a token or password argument", async () => {
    for (const key of ["token", "password", "access_token"]) {
      // oxlint-disable-next-line no-await-in-loop
      const error = await refusal(call("git_status", { [key]: "x" }, recordingAccess().access));
      expect(error.message).toContain("never accept a token");
    }
    const pr = await refusal(
      call("git_pull_request", { title: "t", token: "x" }, recordingAccess().access),
    );
    expect(pr.message).toContain("never accept a token");
  });

  it("refuses unknown fields and malformed values with the field name", async () => {
    const access = recordingAccess().access;
    expect((await refusal(call("git_status", { foo: 1 }, access))).message).toContain(
      "unknown field",
    );
    expect((await refusal(call("git_diff", null, access))).message).toContain("JSON object");
    const path = await refusal(call("git_diff", { path: "../x" }, access));
    expect(path.message).toContain("inside the project");
    expect((await refusal(call("git_diff", { staged: "yes" }, access))).message).toContain(
      "boolean",
    );
    expect((await refusal(call("git_log", { limit: 31 }, access))).message).toContain(
      "between 1 and 30",
    );
    expect((await refusal(call("git_stage", {}, access))).message).toContain("non-empty array");
    expect((await refusal(call("git_stage", { paths: ["../x"] }, access))).message).toContain(
      "inside the project",
    );
    expect((await refusal(call("git_commit", { message: "  " }, access))).message).toContain(
      "message",
    );
    expect(
      (await refusal(call("git_branch", { action: "delete", name: "x" }, access))).message,
    ).toContain("create");
    const name = await refusal(call("git_branch", { action: "create", name: "bad name" }, access));
    expect(name.message).toContain("valid branch name");
    expect((await refusal(call("git_sync", { action: "merge" }, access))).message).toContain(
      "fetch",
    );
    expect((await refusal(call("git_pull_request", {}, access))).message).toContain("title");
  });
});
