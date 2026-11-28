// The create flow's first commit (D-181): a project the IDE just scaffolded must not make
// the chat's clean-tree gate pause the first AI turn for files the user never edited.
//
// IdeController wires Monaco/workers in its constructor, so this drives the real
// createProject on a prototype harness over a fake bridge (the pattern of
// controller-open.test.ts), with the template loader mocked to a two-file manifest.

import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn(), loading: vi.fn() },
}));

vi.mock("../facilis/templates", () => ({
  templateForCreate: () => ({
    load: async () => ({
      manifest: { id: "test-template", install: "npm install", dev: "npm run dev" },
      files: {},
    }),
  }),
  templateForStoredId: () => undefined,
}));

vi.mock("../facilis/project-assets", () => ({
  withTemplateAssets: async (_template: unknown, files: unknown) => files,
}));

import { IdeController } from "./controller";
import { CHECKPOINT_IDENTITY } from "./git-config";

function harness(commit: () => Promise<boolean>) {
  const scm = {
    init: vi.fn(async () => {}),
    stageAll: vi.fn(async () => {}),
    commit: vi.fn(commit),
  };
  const controller = Object.create(IdeController.prototype) as IdeController;
  Object.assign(controller, {
    snap: {},
    bridge: { request: vi.fn(async () => ({ ok: true })), post: vi.fn() },
    folderManifests: new Map(),
    upsertProjectMeta: vi.fn(),
    openFolder: vi.fn(),
    openProjectGraph: vi.fn(),
    status: vi.fn(),
    scm,
  });
  return { controller, scm };
}

describe("createProject scaffold commit", () => {
  it("commits the scaffold the IDE wrote, before any AI turn can see a dirty tree", async () => {
    const { controller, scm } = harness(async () => true);
    await controller.createProject({ dir: "/w/new-app", runInit: false });
    await vi.waitFor(() => expect(scm.commit).toHaveBeenCalledTimes(1));
    expect(scm.init).toHaveBeenCalledWith("/w/new-app");
    expect(scm.stageAll).toHaveBeenCalledWith("/w/new-app");
    expect(scm.commit).toHaveBeenCalledWith(
      "/w/new-app",
      "chore: create new-app",
      CHECKPOINT_IDENTITY,
    );
    expect(scm.init.mock.invocationCallOrder[0]).toBeLessThan(
      scm.commit.mock.invocationCallOrder[0],
    );
  });

  it("keeps the project creation successful when the scaffold commit fails", async () => {
    const { controller, scm } = harness(async () => {
      throw new Error("disk full");
    });
    await expect(controller.createProject({ dir: "/w/broken", runInit: false })).resolves.toBe(
      undefined,
    );
    await vi.waitFor(() => expect(scm.commit).toHaveBeenCalledTimes(1));
  });
});
