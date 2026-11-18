import { describe, expect, it } from "vitest";

import { SchemaConfirmActions } from "./chat-schema-confirm";
import { initialState } from "./chat-session-types";
import type { ChatState } from "./types";

function harness(): { actions: SchemaConfirmActions; state(): ChatState } {
  let state = initialState(null);
  const actions = new SchemaConfirmActions({
    emit: (patch) => {
      state = { ...state, ...patch };
    },
    state: () => state,
  });
  return { actions, state: () => state };
}

describe("SchemaConfirmActions", () => {
  it("shows the drops and resolves apply", async () => {
    const h = harness();
    const decision = h.actions.pause(['drops table "todos"']);
    expect(h.state().schemaConfirm).toEqual(['drops table "todos"']);
    h.actions.apply();
    await expect(decision).resolves.toBe("apply");
    expect(h.state().schemaConfirm).toBeNull();
  });

  it("resolves cancel and clears the card", async () => {
    const h = harness();
    const decision = h.actions.pause(['drops column "todos.title"']);
    h.actions.cancel();
    await expect(decision).resolves.toBe("cancel");
    expect(h.state().schemaConfirm).toBeNull();
  });

  it("ignores a second answer for the same pause", async () => {
    const h = harness();
    const decision = h.actions.pause(['drops table "todos"']);
    h.actions.cancel();
    h.actions.apply();
    await expect(decision).resolves.toBe("cancel");
  });

  it("is a no-op when nothing is paused", () => {
    const h = harness();
    h.actions.cancel();
    expect(h.state().schemaConfirm).toBeNull();
  });
});
