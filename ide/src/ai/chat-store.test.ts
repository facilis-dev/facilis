import { describe, expect, it } from "vitest";
import { ChatStore } from "./chat-store";
import { answer, sessionWith } from "./chat-session-fixtures";

/** A store over real (deterministic) ChatSessions: no React, no provider. */
function storeWithCount(): { store: ChatStore; created: () => number } {
  let created = 0;
  const store = new ChatStore(() => {
    created += 1;
    return sessionWith(async () => ({ ok: true, text: answer() }));
  });
  return { store, created: () => created };
}

describe("ChatStore", () => {
  it("starts with one active conversation", () => {
    const { store } = storeWithCount();
    expect(store.list()).toHaveLength(1);
    expect(store.getSnapshot()).toBe("chat-1");
    expect(store.active()).toBe(store.list()[0]?.session);
  });

  it("creates a conversation without touching the previous one", () => {
    const { store, created } = storeWithCount();
    const first = store.active();
    store.create();
    expect(created()).toBe(2);
    expect(store.getSnapshot()).toBe("chat-2");
    expect(store.list().map((entry) => entry.id)).toEqual(["chat-1", "chat-2"]);
    expect(store.list()[0]?.session).toBe(first);
  });

  it("selects an existing conversation and ignores unknown ids", () => {
    const { store } = storeWithCount();
    const first = store.active();
    store.create();
    store.select("chat-1");
    expect(store.active()).toBe(first);
    store.select("missing");
    expect(store.getSnapshot()).toBe("chat-1");
  });

  it("keeps each conversation's state across switches", async () => {
    const { store } = storeWithCount();
    const first = store.active();
    await first.send("hello");
    store.create();
    expect(store.active().getSnapshot().messages).toEqual([]);

    store.select("chat-1");
    expect(store.active()).toBe(first);
    expect(
      store
        .active()
        .getSnapshot()
        .messages.map((message) => message.content),
    ).toEqual(["hello", "Here is the change."]);
  });

  it("keeps the active conversation when another one is removed", () => {
    const { store } = storeWithCount();
    store.create();
    const active = store.active();
    store.remove("chat-1");
    expect(store.getSnapshot()).toBe("chat-2");
    expect(store.active()).toBe(active);
    expect(store.list().map((entry) => entry.id)).toEqual(["chat-2"]);
  });

  it("falls back to the next conversation when the active one is removed", () => {
    const { store } = storeWithCount();
    store.create();
    const first = store.list()[0]?.session;
    store.remove("chat-2");
    expect(store.getSnapshot()).toBe("chat-1");
    expect(store.active()).toBe(first);
  });

  it("always keeps one conversation: removing the last one starts a fresh chat", () => {
    const { store, created } = storeWithCount();
    store.remove("chat-1");
    expect(store.list()).toHaveLength(1);
    expect(store.getSnapshot()).not.toBe("chat-1");
    expect(created()).toBe(2);
  });

  it("notifies subscribers on create, select and remove", () => {
    const { store } = storeWithCount();
    let changes = 0;
    const unsubscribe = store.subscribe(() => {
      changes += 1;
    });
    store.create();
    store.select("chat-1");
    store.select("chat-1"); // already active: no extra notification
    store.remove("chat-1");
    expect(changes).toBe(3);

    unsubscribe();
    store.create();
    expect(changes).toBe(3);
  });
});
