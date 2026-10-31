// Server-sent events, exactly as the chat client needs them (D-045/D-046).
//
// The reader is protocol-small on purpose: it decodes UTF-8 incrementally so a
// multi-byte character split across chunks survives, and it keeps the data
// buffer across chunks so an event split at any boundary is still one event.
// The client decides what the payloads mean (including `[DONE]`).

export type SseHandler = (data: string) => void;

const LF = "\n";
const CR = "\r";

interface Line {
  line: string;
  rest: string;
}

/**
 * The next complete line, or null when the buffer ends without a line break or
 * with a lone CR whose LF (the other half of a CRLF) may still arrive in the
 * next chunk. Appending one final LF flushes whatever is left.
 */
function takeLine(buffer: string): Line | null {
  for (let index = 0; index < buffer.length; index += 1) {
    const char = buffer[index];
    if (char === LF) return { line: buffer.slice(0, index), rest: buffer.slice(index + 1) };
    if (char === CR) {
      if (index === buffer.length - 1) return null;
      const width = buffer[index + 1] === LF ? 2 : 1;
      return { line: buffer.slice(0, index), rest: buffer.slice(index + width) };
    }
  }
  return null;
}

/** The value of a `data:` field, or null for every field the client ignores. */
function dataValue(line: string): string | null {
  if (line.startsWith(":")) return null;
  const colon = line.indexOf(":");
  const field = colon === -1 ? line : line.slice(0, colon);
  if (field !== "data") return null;
  if (colon === -1) return "";
  const value = line.slice(colon + 1);
  return value.startsWith(" ") ? value.slice(1) : value;
}

export async function readSse(body: ReadableStream<Uint8Array>, onData: SseHandler): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  // Data lines accumulate across chunks: an event may be split anywhere.
  const data: string[] = [];
  let buffer = "";

  function dispatch(): void {
    if (data.length === 0) return;
    const payload = data.join("\n");
    data.length = 0;
    onData(payload);
  }

  function handle(line: string): void {
    if (line === "") {
      dispatch();
      return;
    }
    const value = dataValue(line);
    if (value !== null) data.push(value);
  }

  function drain(): void {
    for (;;) {
      const next = takeLine(buffer);
      if (next === null) return;
      buffer = next.rest;
      handle(next.line);
    }
  }

  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      drain();
    }
    // A final LF terminates the last line and dispatches an event the provider
    // did not follow with a blank line (a trailing lone CR pairs with it too).
    buffer += decoder.decode();
    buffer += LF;
    drain();
    dispatch();
  } finally {
    reader.releaseLock();
  }
}
