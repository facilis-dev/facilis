// Streaming the answer's `message` field without re-rendering per token.
//
// The provider streams the raw AIResponse JSON; stream-message.ts turns its prefix
// into readable text, and this accumulator decides when the panel should paint:
// only when the visible text changed AND enough time passed since the last paint.
// ChatStreamWriter owns the bubble: it sets its content from what push() returns and
// replaces it with the parsed message when the answer completes.

import { streamingMessage } from "./stream-message";
import type { ChatMessage, ChatState } from "./types";

const EMIT_MS = 30;

export class StreamAccumulator {
  private readonly now: () => number;
  private raw = "";
  private visible = "";
  private lastEmit = 0;
  private painted = false;

  constructor(now: () => number) {
    this.now = now;
  }

  /** The new visible prefix to paint, or null when there is nothing new. */
  push(chunk: string): string | null {
    this.raw += chunk;
    const visible = streamingMessage(this.raw);
    if (visible === null || visible === this.visible) return null;
    this.visible = visible;
    const now = this.now();
    if (this.painted && now - this.lastEmit < EMIT_MS) return null;
    this.lastEmit = now;
    this.painted = true;
    return visible;
  }

  reset(): void {
    this.raw = "";
    this.visible = "";
    this.lastEmit = 0;
    this.painted = false;
  }
}

/** What the writer needs from the session: the live transcript and its state sink. */
export interface StreamPort {
  messages(): readonly ChatMessage[];
  next(role: ChatMessage["role"], content: string): ChatMessage;
  emit(patch: Partial<ChatState>): void;
}

/**
 * The live assistant bubble of one turn: paints the streamed `message` prefix into a bubble,
 * then finishes it with the parsed answer or drops it when the answer never parsed.
 */
export class ChatStreamWriter {
  private readonly port: StreamPort;
  private accumulator: StreamAccumulator;
  private id: string | null = null;

  constructor(now: () => number, port: StreamPort) {
    this.port = port;
    this.accumulator = new StreamAccumulator(now);
  }

  /** The visible text of a streamed chunk became available and should be painted. */
  chunk(chunk: string): void {
    const visible = this.accumulator.push(chunk);
    if (visible === null) return;
    const id = this.id;
    if (id === null) {
      const message = this.port.next("assistant", visible);
      this.id = message.id;
      this.port.emit({ streaming: true, messages: [...this.port.messages(), message] });
      return;
    }
    this.port.emit({
      messages: this.port
        .messages()
        .map((message) => (message.id === id ? { ...message, content: visible } : message)),
    });
  }

  /** Complete the bubble; a turn with no visible chunk still gets one. */
  finish(content: string): void {
    const id = this.id;
    this.id = null;
    this.port.emit({
      streaming: false,
      messages:
        id === null
          ? [...this.port.messages(), this.port.next("assistant", content)]
          : this.port
              .messages()
              .map((message) => (message.id === id ? { ...message, content } : message)),
    });
  }

  /** Remove a partial bubble whose answer never parsed (no assistant bubble survives). */
  drop(): void {
    const id = this.id;
    this.id = null;
    this.port.emit({
      streaming: false,
      ...(id === null
        ? {}
        : { messages: this.port.messages().filter((message) => message.id !== id) }),
    });
  }

  /** A new turn starts clean. */
  reset(): void {
    this.accumulator.reset();
    this.id = null;
  }
}
