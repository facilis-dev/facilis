// Streaming the answer's `message` field without re-rendering per token.
//
// The provider streams the raw AIResponse JSON; stream-message.ts turns its prefix
// into readable text, and this accumulator decides when the panel should paint:
// only when the visible text changed AND enough time passed since the last paint.
// The session sets the bubble's content from what push() returns and replaces it
// with the parsed message when the answer completes.

import { streamingMessage } from "./stream-message";

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
