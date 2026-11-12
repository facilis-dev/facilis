// The pending-message queue of one conversation (owner report 2026-11-12): a message typed
// while a turn is running waits here and starts FIFO when the session returns to idle.
//
// Split out of chat-session.ts (300-line limit): the session decides WHEN a queued message
// starts, this module owns the list and keeps ChatState.queued a snapshot after every change.

import type { ChatQueuedMessage } from "./types";

/** Called with the whole queue after each change, so the session can emit it. */
type QueueListener = (queued: ChatQueuedMessage[]) => void;

export class ChatQueue {
  private items: ChatQueuedMessage[] = [];
  private seq = 0;
  private readonly notify: QueueListener;
  private readonly now: () => number;
  // Erasable syntax only (tsconfig): no parameter properties in this app.
  constructor(notify: QueueListener, now: () => number) {
    this.notify = notify;
    this.now = now;
  }

  push(text: string, images: readonly string[]): void {
    this.seq += 1;
    const id = "queued-" + this.seq;
    this.items = [...this.items, { id, text, images, at: this.now() }];
    this.notify(this.items);
  }

  remove(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
    this.notify(this.items);
  }

  /** Take the oldest message; null when nothing waits. */
  shift(): ChatQueuedMessage | null {
    const [next, ...rest] = this.items;
    if (next === undefined) return null;
    this.items = rest;
    this.notify(this.items);
    return next;
  }

  clear(): void {
    this.items = [];
    this.notify(this.items);
  }
}
