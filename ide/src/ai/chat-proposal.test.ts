import { describe, expect, it } from "vitest";
import type { FilePatch } from "@facilis.dev/ai";
import { buildProposal } from "./chat-proposal";

const files: Record<string, string> = {
  "src/App.tsx": "export const App = () => null;\n",
};

const read = async (path: string) => files[path] ?? "";

describe("buildProposal", () => {
  it("builds an accepted proposal for a create without reading the file", async () => {
    const patch: FilePatch = { path: "src/new.ts", action: "create", content: "a\nb\n" };
    const proposal = await buildProposal([patch], ["note"], true, async () => {
      throw new Error("create must not read the before-image");
    });
    expect(proposal.files).toHaveLength(1);
    expect(proposal.files[0]?.accepted).toBe(true);
    expect(proposal.files[0]?.before).toBeNull();
    expect(proposal.files[0]?.added).toBe(2);
    expect(proposal.files[0]?.removed).toBe(0);
    expect(proposal.notes).toEqual(["note"]);
    expect(proposal.requiresConfirmation).toBe(true);
  });

  it("keeps the before-image of an update for the diff and for Undo", async () => {
    const patch: FilePatch = {
      path: "src/App.tsx",
      action: "update",
      content: "export const App = 1;\n",
    };
    const proposal = await buildProposal([patch], [], false, read);
    expect(proposal.files[0]?.before).toBe(files["src/App.tsx"]);
    expect(proposal.files[0]?.added).toBe(1);
    expect(proposal.files[0]?.removed).toBe(1);
  });

  it("renders a delete as removals and can restore it", async () => {
    const patch: FilePatch = { path: "src/App.tsx", action: "delete" };
    const proposal = await buildProposal([patch], [], false, read);
    expect(proposal.files[0]?.before).toBe(files["src/App.tsx"]);
    expect(proposal.files[0]?.added).toBe(0);
    expect(proposal.files[0]?.removed).toBe(1);
  });

  it("treats an update of a missing file as a diff from empty", async () => {
    const patch: FilePatch = { path: "src/missing.ts", action: "update", content: "x\n" };
    const proposal = await buildProposal([patch], [], false, read);
    expect(proposal.files[0]?.before).toBeNull();
    expect(proposal.files[0]?.added).toBe(1);
    expect(proposal.files[0]?.removed).toBe(0);
  });

  it("warns when browser code uses Node globals or server modules", async () => {
    const patch: FilePatch = {
      path: "src/App.tsx",
      action: "update",
      content: 'import { db } from "@facilis.dev/db";\nexport const x = process.env.X;\n',
    };
    const proposal = await buildProposal([patch], [], false, read);
    expect(proposal.warnings).toEqual([
      { path: "src/App.tsx", rule: "server-import", symbol: "@facilis.dev/db" },
      { path: "src/App.tsx", rule: "node-global", symbol: "process" },
    ]);
  });

  it("does not warn about server routes", async () => {
    const patch: FilePatch = {
      path: "server/routes/api/x.get.ts",
      action: "create",
      content: "export const token = process.env.SECRET;\n",
    };
    const proposal = await buildProposal([patch], [], false, async () => "");
    expect(proposal.warnings).toEqual([]);
  });
});
