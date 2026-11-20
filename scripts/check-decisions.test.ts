import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectDecisions, main, renderIndex, slugify } from "./check-decisions.mjs";

const roots: string[] = [];

/** A throwaway repo root holding `docs/decisions` with the given files. */
function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "facilis-decisions-"));
  roots.push(root);
  const dir = path.join(root, "docs/decisions");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), text);
  }
  return root;
}

const decision = (id: string, title: string, status = "accepted (2026-10-25)") =>
  `# ${id} — ${title}\n**Status:** ${status}\n\n**Decision.** nothing to see.\n`;

/** Exit code of a `main` run with output swallowed, so the suite stays readable. */
function run(argv: string[], cwd: string): number {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  return main(argv, cwd);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("slugify", () => {
  it("keeps a short title as one kebab-case word sequence", () => {
    expect(slugify("Toolchain defaults")).toBe("toolchain-defaults");
  });

  it("drops markup and punctuation, keeping the version digits", () => {
    expect(slugify("Stack locked to spec §2.1")).toBe("stack-locked-to-spec-2-1");
    expect(slugify("A patch that writes invalid JSON is refused")).toBe(
      "a-patch-that-writes-invalid-json-is-refused",
    );
  });

  it("truncates a long title on a word boundary", () => {
    const slug = slugify(
      "The commit box generates a Conventional Commit from the changes, and never commits it",
    );
    expect(slug.length).toBeLessThanOrEqual(70);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.startsWith("the-commit-box-generates-a-conventional-commit-from")).toBe(true);
  });
});

describe("collectDecisions", () => {
  it("reads id, title, status and date, and skips the generated index", () => {
    const root = fixture({
      "D-001-a-first-decision.md": decision("D-001", "A first decision"),
      "D-002-superseded-one.md": decision(
        "D-002",
        "Superseded one",
        "superseded by D-001 (2026-01-02)",
      ),
      "README.md": "<!-- generated -->\n",
    });
    const { entries, errors } = collectDecisions(path.join(root, "docs/decisions"));
    expect(errors).toEqual([]);
    expect(entries.map((entry) => [entry.id, entry.status, entry.date])).toEqual([
      ["D-001", "accepted", "2026-10-25"],
      ["D-002", "superseded", "2026-01-02"],
    ]);
  });

  it("reports a file name that does not follow the convention", () => {
    const root = fixture({ "d-001-a-first-decision.md": decision("D-001", "A first decision") });
    const { entries, errors } = collectDecisions(path.join(root, "docs/decisions"));
    expect(entries).toEqual([]);
    expect(errors[0]).toContain("D-0NN-<slug>.md");
  });
});

describe("main", () => {
  const files = {
    "D-001-a-first-decision.md": decision("D-001", "A first decision"),
    "D-002-a-second-decision.md": decision("D-002", "A second decision"),
  };

  it("fails on a missing index, then writes one and passes", () => {
    const root = fixture(files);
    expect(run([], root)).toBe(1);
    expect(run(["--write"], root)).toBe(0);
    expect(run([], root)).toBe(0);
  });

  it("fails when a number is used twice", () => {
    const root = fixture({
      ...files,
      "D-002-a-third-decision.md": decision("D-002", "A third decision"),
    });
    expect(run(["--write"], root)).toBe(1);
    expect(run([], root)).toBe(1);
  });

  it("fails when the slug does not match the title", () => {
    const root = fixture({ "D-001-wrong-slug.md": decision("D-001", "A first decision") });
    expect(run(["--write"], root)).toBe(1);
  });

  it("fails on a stale index", () => {
    const root = fixture(files);
    expect(run(["--write"], root)).toBe(0);
    fs.writeFileSync(
      path.join(root, "docs/decisions/D-003-a-late-decision.md"),
      decision("D-003", "A late decision"),
    );
    expect(run([], root)).toBe(1);
  });

  it("renders one table row per decision, escaping pipes", () => {
    const root = fixture({
      "D-001-pipe-in-the-title.md": decision("D-001", "Pipe | in the title"),
    });
    const { entries } = collectDecisions(path.join(root, "docs/decisions"));
    expect(renderIndex(entries)).toContain(
      "| [D-001](./D-001-pipe-in-the-title.md) | Pipe \\| in the title | accepted | 2026-10-25 |",
    );
  });
});
