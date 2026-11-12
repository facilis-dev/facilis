// The chat's conversations (owner report 2026-11-12): several independent ChatSessions with
// one active at a time, so creating a chat keeps the previous one instead of wiping it.
//
// In-memory only: nothing is persisted, so reloading the page starts clean (the same promise
// the single-session chat-host made before). chat-host.ts keeps one store per controller and
// builds the sessions; this module only owns how many there are and which one is active.

import type { ChatSession } from "./chat-session";

export interface ChatConversation {
  id: string;
  session: ChatSession;
}

export class ChatStore {
  private readonly sessions = new Map<string, ChatSession>();
  private readonly listeners = new Set<() => void>();
  private readonly createSession: () => ChatSession;
  private activeId: string;
  private activeSession: ChatSession;
  private seq = 0;

  // Erasable syntax only (tsconfig): no parameter properties in this app.
  constructor(createSession: () => ChatSession) {
    this.createSession = createSession;
    const id = this.nextId();
    this.activeSession = createSession();
    this.activeId = id;
    this.sessions.set(id, this.activeSession);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** A primitive snapshot, so useSyncExternalStore re-renders on every switch. */
  getSnapshot = (): string => this.activeId;

  active(): ChatSession {
    return this.activeSession;
  }

  list(): ChatConversation[] {
    return [...this.sessions].map(([id, session]) => ({ id, session }));
  }

  /** Start another conversation; the current one stays in the list, untouched. */
  create(): ChatSession {
    const id = this.nextId();
    const session = this.createSession();
    this.sessions.set(id, session);
    this.activate(id, session);
    return session;
  }

  select(id: string): void {
    if (id === this.activeId) return;
    const session = this.sessions.get(id);
    if (session === undefined) return;
    this.activate(id, session);
  }

  remove(id: string): void {
    const session = this.sessions.get(id);
    if (session === undefined) return;
    // Stop a running turn and drop its queue before the conversation becomes unreachable.
    session.newChat();
    this.sessions.delete(id);
    if (id !== this.activeId) {
      this.notify();
      return;
    }
    const next = this.sessions.entries().next().value;
    if (next === undefined) {
      this.create();
      return;
    }
    this.activate(next[0], next[1]);
  }

  private activate(id: string, session: ChatSession): void {
    this.activeId = id;
    this.activeSession = session;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private nextId(): string {
    this.seq += 1;
    return "chat-" + String(this.seq);
  }
}
