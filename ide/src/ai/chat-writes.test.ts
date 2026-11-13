import { describe, expect, it } from "vitest";

import type { Analysis, FilePatch, SyntaxChecker } from "@facilis.dev/ai";
import { overlayPatches } from "@/facilis/patch-analysis";
import type { ApplyPatchInput, ApplyPatchResult } from "@/facilis/apply-patch";
import { analyzeSources } from "./analysis-fixtures";
import {
  createChatWrites,
  MAX_WRITE_CHARS,
  type ChatWrites,
  type ChatWritesHost,
  type WriteOutcome,
} from "./chat-writes";
import type { ChatGitGateFailure, GitGate, GitSafety } from "./types";

const APP = "export const App = () => null;\n";
const CHECKED: SyntaxChecker = { check: async () => [] };
const emptyAnalysis = (): Analysis => analyzeSources(new Map());

const APP_PATH = "src/App.tsx";

const CLEAN_GATE: GitGate = { ok: true, head: "0123456789abcdef" };

interface Harness {
  host: ChatWritesHost;
  writes: ChatWrites;
  analyzes: { patches: readonly FilePatch[]; overlay: readonly FilePatch[] }[];
  applyCalls: ApplyPatchInput[];
  restores: string[][];
  gateCalls(): number;
  setGate(gate: GitGate): void;
}

interface HarnessOptions {
  gate?: GitGate;
  restore?: { ok: boolean; errors: string[] };
  apply?: (input: ApplyPatchInput) => Promise<ApplyPatchResult>;
  analyze?: (
    patches: readonly FilePatch[],
    overlay: readonly FilePatch[],
  ) => {
    before: Analysis;
    after: Analysis;
  };
}

/** The kernel-bridge writer's success shape: the fake apply never re-validates. */
function defaultApply(input: ApplyPatchInput): Promise<ApplyPatchResult> {
  const written = input.patches.filter((patch) => patch.action !== "delete").map((p) => p.path);
  const deleted = input.patches.filter((patch) => patch.action === "delete").map((p) => p.path);
  return Promise.resolve({
    ok: true,
    validation: { ok: true, errors: [], warnings: [] },
    written,
    deleted,
    revision: null,
    errors: [],
  });
}

function harness(overrides: Partial<ChatWritesHost> = {}, options: HarnessOptions = {}): Harness {
  const analyzes: Harness["analyzes"] = [];
  const applyCalls: ApplyPatchInput[] = [];
  const restores: string[][] = [];
  let gate: GitGate = options.gate ?? CLEAN_GATE;
  let gateCalls = 0;
  const restore = options.restore ?? { ok: true, errors: [] };
  const safety: GitSafety = {
    async gate() {
      gateCalls += 1;
      return gate;
    },
    async commitAll() {
      return { ok: true };
    },
    async init() {
      return { ok: true };
    },
    async restore(paths) {
      restores.push([...paths]);
      return restore;
    },
  };
  const algorithm =
    options.analyze ?? (() => ({ before: emptyAnalysis(), after: emptyAnalysis() }));
  const host: ChatWritesHost = {
    root: () => "/projects/app",
    bridge: { request: async () => ({ ok: true }) },
    manifestBase: () => null,
    files: () => [APP_PATH],
    read: async (path) => (path === APP_PATH ? APP : ""),
    syntaxChecker: () => CHECKED,
    async analyze(patches, _signal, overlay = []) {
      analyzes.push({ patches: [...patches], overlay: [...overlay] });
      return algorithm(patches, overlay);
    },
    safety,
    ...overrides,
  };
  const writes = createChatWrites(host, {
    apply: async (input) => {
      applyCalls.push(input);
      return (options.apply ?? defaultApply)(input);
    },
  });
  return {
    host,
    writes,
    analyzes,
    applyCalls,
    restores,
    gateCalls: () => gateCalls,
    setGate: (next) => {
      gate = next;
    },
  };
}

function findingRules(outcome: WriteOutcome): string[] {
  if (outcome.ok || !("errors" in outcome)) return [];
  return outcome.errors.flatMap((entry) =>
    typeof entry === "object" && entry !== null && !Array.isArray(entry) && "rule" in entry
      ? [String(entry.rule)]
      : [],
  );
}

const DIRTY: ChatGitGateFailure = {
  code: "dirty-tree",
  changes: [{ path: "src/App.tsx", letter: "M" }],
};

describe("createChatWrites git gate", () => {
  it("refuses the first write while the tree is dirty and reports the failure once", async () => {
    const h = harness({}, { gate: { ok: false, failure: DIRTY } });
    const outcome = await h.writes.writeFile("src/new.ts", "export const value = 1;\n");
    expect(outcome).toEqual({ ok: false, path: "src/new.ts", git: DIRTY });
    expect(h.analyzes).toHaveLength(0);
    expect(h.applyCalls).toHaveLength(0);
    expect(h.writes.takeGateFailure()).toEqual(DIRTY);
    expect(h.writes.takeGateFailure()).toBeNull();
  });

  it("re-checks a refused gate on retry, so commit-and-continue can succeed", async () => {
    const h = harness({}, { gate: { ok: false, failure: { code: "no-head" } } });
    expect((await h.writes.writeFile("src/a.ts", "export const a = 1;\n")).ok).toBe(false);
    h.setGate(CLEAN_GATE);
    const retry = await h.writes.writeFile("src/a.ts", "export const a = 1;\n");
    expect(retry.ok).toBe(true);
    expect(h.gateCalls()).toBe(2);
  });
});

describe("createChatWrites write_file", () => {
  it("validates, applies and journals a clean write", async () => {
    const h = harness();
    const content = "export const value = 1;\n";
    const outcome = await h.writes.writeFile("src/value.ts", content);
    expect(outcome).toEqual({
      ok: true,
      path: "src/value.ts",
      action: "create",
      bytes: content.length,
      destructive: false,
      added: 1,
      removed: 0,
    });
    expect(h.gateCalls()).toBe(1);
    expect(h.analyzes).toHaveLength(1);
    expect(h.analyzes[0]?.overlay).toEqual([]);
    const input = h.applyCalls[0];
    expect(input?.patches).toEqual([{ path: "src/value.ts", action: "create", content }]);
    expect(input?.requiresConfirmation).toBe(true);
    expect(input?.context).toBeDefined();
    expect(h.writes.turnWrites()).toEqual([
      { path: "src/value.ts", action: "create", destructive: false, added: 1, removed: 0 },
    ]);
  });

  it("feeds the turn's earlier writes to the analyzer as the overlay", async () => {
    const h = harness();
    const first = "export const one = 1;\n";
    await h.writes.writeFile("src/one.ts", first);
    await h.writes.writeFile("src/two.ts", "export const two = 2;\n");
    expect(h.gateCalls()).toBe(1);
    expect(h.analyzes[1]?.overlay).toEqual([
      { path: "src/one.ts", action: "create", content: first },
    ]);
    expect(h.writes.turnWrites()).toHaveLength(2);
  });

  it("updates an existing file and counts the changed lines", async () => {
    const h = harness();
    const outcome = await h.writes.writeFile(
      APP_PATH,
      "export const App = () => null;\nexport const x = 1;\n",
    );
    expect(outcome).toMatchObject({ ok: true, action: "update", added: 1, removed: 0 });
  });

  it("returns validator findings as data and never applies", async () => {
    const h = harness({
      syntaxChecker: () => ({
        check: async () => [{ line: 1, column: 1, message: "Unexpected token" }],
      }),
    });
    const outcome = await h.writes.writeFile("src/broken.ts", "export const = ;\n");
    expect(outcome.ok).toBe(false);
    expect(findingRules(outcome)).toContain("ts-parse");
    expect(h.applyCalls).toHaveLength(0);
    expect(h.writes.turnWrites()).toHaveLength(0);
    expect(h.writes.outage()).toBe(false);
  });

  it("marks a validator outage instead of asking the model to repair", async () => {
    const h = harness(
      {},
      {
        analyze: () => {
          throw new Error("analyzer worker did not become ready");
        },
      },
    );
    const outcome = await h.writes.writeFile("src/a.ts", "export const a = 1;\n");
    expect(findingRules(outcome)).toEqual(["project-analysis"]);
    expect(h.writes.outage()).toBe(true);
    expect(h.applyCalls).toHaveLength(0);
    h.writes.beginTurn();
    expect(h.writes.outage()).toBe(false);
  });

  it("refuses an unsafe path and an over-cap write before validating", async () => {
    const h = harness();
    expect(findingRules(await h.writes.writeFile("../outside.ts", "x\n"))).toEqual([
      "file-path-allowed",
    ]);
    expect(
      findingRules(await h.writes.writeFile("src/huge.ts", "x".repeat(MAX_WRITE_CHARS + 1))),
    ).toEqual(["file-content-cap"]);
    expect(h.analyzes).toHaveLength(0);
    expect(h.applyCalls).toHaveLength(0);
  });

  it("reports a kernel write failure as findings and journals nothing", async () => {
    const h = harness(
      {},
      {
        apply: async () => ({
          ok: false,
          validation: { ok: true, errors: [], warnings: [] },
          written: [],
          deleted: [],
          revision: null,
          errors: ["src/a.ts: kernel refused"],
        }),
      },
    );
    const outcome = await h.writes.writeFile("src/a.ts", "export const a = 1;\n");
    expect(findingRules(outcome)).toEqual(["apply-failed"]);
    expect(h.writes.turnWrites()).toHaveLength(0);
  });
});

const SCHEMA = `import { pgTable, text, uuid } from "drizzle-orm/pg-core";

export const todos = pgTable("todos", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
});
`;

describe("createChatWrites delete_file", () => {
  it("validates a destructive delete against the overlay and flags it", async () => {
    const sources = new Map([["db/schema.ts", SCHEMA]]);
    const h = harness(
      {
        files: () => [...sources.keys()],
        read: async (path) => sources.get(path) ?? "",
      },
      {
        analyze: (patches, overlay) => {
          const base = overlayPatches(sources, overlay);
          return {
            before: analyzeSources(base),
            after: analyzeSources(overlayPatches(base, patches)),
          };
        },
      },
    );
    const outcome = await h.writes.deleteFile("db/schema.ts");
    expect(outcome).toMatchObject({
      ok: true,
      path: "db/schema.ts",
      action: "delete",
      bytes: 0,
      destructive: true,
    });
    expect(h.applyCalls[0]?.patches).toEqual([{ path: "db/schema.ts", action: "delete" }]);
    expect(h.writes.turnWrites()).toEqual([
      expect.objectContaining({ path: "db/schema.ts", action: "delete", destructive: true }),
    ]);
  });
});

describe("createChatWrites undoTurn", () => {
  it("restores exactly the journaled paths, once", async () => {
    const h = harness();
    await h.writes.writeFile("src/a.ts", "export const a = 1;\n");
    await h.writes.writeFile("src/b.ts", "export const b = 1;\n");
    await h.writes.deleteFile(APP_PATH);
    expect(await h.writes.undoTurn()).toEqual({ ok: true, errors: [] });
    expect(h.restores).toEqual([["src/a.ts", "src/b.ts", APP_PATH]]);
    expect(h.writes.turnWrites()).toEqual([]);
    expect(await h.writes.undoTurn()).toEqual({ ok: true, errors: [] });
    expect(h.restores).toHaveLength(1);
  });

  it("surfaces restore failures without retrying blindly", async () => {
    const h = harness({}, { restore: { ok: false, errors: ["git restore failed at src/a.ts"] } });
    await h.writes.writeFile("src/a.ts", "export const a = 1;\n");
    expect(await h.writes.undoTurn()).toEqual({
      ok: false,
      errors: ["git restore failed at src/a.ts"],
    });
    expect(h.restores).toHaveLength(1);
  });
});
