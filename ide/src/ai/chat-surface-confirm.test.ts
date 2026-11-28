import { describe, expect, it } from "vitest";

import type { SurfaceRequest } from "@facilis.dev/ai";

import { SurfaceConfirmActions } from "./chat-surface-confirm";
import { initialState } from "./chat-session-types";
import type { ChatState } from "./types";

const REQUESTS: readonly SurfaceRequest[] = [
  {
    path: "server/routes/hook.post.ts",
    capability: "raw-route",
    reason: "signed webhook endpoint",
    snippet: "export default defineRawRoute({",
    line: 4,
  },
];

function harness(): { actions: SurfaceConfirmActions; state(): ChatState } {
  let state = initialState(null);
  const actions = new SurfaceConfirmActions({
    emit: (patch) => {
      state = { ...state, ...patch };
    },
    state: () => state,
  });
  return { actions, state: () => state };
}

describe("SurfaceConfirmActions", () => {
  it("shows the declarations and resolves the confirm with the edited reasons", async () => {
    const h = harness();
    const decision = h.actions.pause(REQUESTS);
    expect(h.state().surfaceConfirm).toEqual(REQUESTS);
    h.actions.confirm({ "server/routes/hook.post.ts:4:raw-route": "stripe signature" });
    await expect(decision).resolves.toEqual({
      kind: "confirm",
      reasons: { "server/routes/hook.post.ts:4:raw-route": "stripe signature" },
    });
    expect(h.state().surfaceConfirm).toBeNull();
  });

  it("resolves a confirm with no edited reasons as an empty map", async () => {
    const h = harness();
    const decision = h.actions.pause(REQUESTS);
    h.actions.confirm();
    await expect(decision).resolves.toEqual({ kind: "confirm", reasons: {} });
  });

  it("resolves cancel and clears the card", async () => {
    const h = harness();
    const decision = h.actions.pause(REQUESTS);
    h.actions.cancel();
    await expect(decision).resolves.toEqual({ kind: "cancel" });
    expect(h.state().surfaceConfirm).toBeNull();
  });

  it("ignores a second answer for the same pause", async () => {
    const h = harness();
    const decision = h.actions.pause(REQUESTS);
    h.actions.cancel();
    h.actions.confirm();
    await expect(decision).resolves.toEqual({ kind: "cancel" });
  });

  it("is a no-op when nothing is paused", () => {
    const h = harness();
    h.actions.cancel();
    expect(h.state().surfaceConfirm).toBeNull();
  });
});
