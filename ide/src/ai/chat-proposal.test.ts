import { describe, expect, it } from "vitest";
import type { FilePatch } from "@facilis/ai";
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
    expect(proposal.files[0]?.added).toBe(2);
    expect(proposal.files[0]?.removed).toBe(0);
    expect(proposal.notes).toEqual(["note"]);
    expect(proposal.requiresConfirmation).toBe(true);
  });

  it("diffs an update against the file on disk", async () => {
    const patch: FilePatch = {
      path: "src/App.tsx",
      action: "update",
      content: "export const App = 1;\n",
    };
    const proposal = await buildProposal([patch], [], false, read);
    expect(proposal.files[0]?.added).toBe(1);
    expect(proposal.files[0]?.removed).toBe(1);
  });

  it("renders a delete as removals", async () => {
    const patch: FilePatch = { path: "src/App.tsx", action: "delete" };
    const proposal = await buildProposal([patch], [], false, read);
    expect(proposal.files[0]?.added).toBe(0);
    expect(proposal.files[0]?.removed).toBe(1);
  });

  it("treats an update of a missing file as a diff from empty", async () => {
    const patch: FilePatch = { path: "src/missing.ts", action: "update", content: "x\n" };
    const proposal = await buildProposal([patch], [], false, read);
    expect(proposal.files[0]?.added).toBe(1);
    expect(proposal.files[0]?.removed).toBe(0);
  });
});
