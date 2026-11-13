// write_file / delete_file for the PTC runtime (D-181).
//
// Thin by design: this module only refuses malformed arguments. Policy, validation, the git
// gate and the turn journal all live in chat-writes.ts, which the chat session shares so the
// tools' writes and the turn's Undo are the same records. A refused write is DATA (the model
// reads the findings and repairs the call); only a malformed call throws.

import type { ChatWrites, WriteOutcome } from "../chat-writes";
import type { RuntimeToolHandler } from "./graph-tools";
import { PtcToolError, type PtcJson } from "./protocol";

/** The router host slice: the family is advertised exactly when the engine exists. */
export interface WriteToolHost {
  readonly writes?: ChatWrites;
}

/** Same bound as the read tools: a path longer than this is a malformed argument. */
const MAX_PATH_CHARS = 500;

type Args = Record<string, unknown>;

function refuse(message: string): never {
  throw new PtcToolError("capability", message);
}

function argsOf(value: unknown): Args {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    refuse(
      "arguments must be one JSON object, e.g. tools.write_file({ path: 'src/App.tsx', content: '...' })",
    );
  }
  return value as Args;
}

function pathOf(args: Args): string {
  const path = args["path"];
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH_CHARS) {
    refuse("path must be a non-empty string of at most " + MAX_PATH_CHARS + " characters");
  }
  return path;
}

function contentOf(args: Args): string {
  const content = args["content"];
  if (typeof content !== "string") refuse("content must be a string");
  return content;
}

/** The engine already returns plain JSON; the round trip keeps the sandbox boundary honest. */
function json(outcome: WriteOutcome): PtcJson {
  return JSON.parse(JSON.stringify(outcome)) as PtcJson;
}

export function createWriteToolHandlers(
  host: WriteToolHost,
): Readonly<Record<string, RuntimeToolHandler>> {
  const writes = host.writes;
  if (writes === undefined) return {};
  return {
    async write_file(rawArgs) {
      const args = argsOf(rawArgs);
      return json(await writes.writeFile(pathOf(args), contentOf(args)));
    },
    async delete_file(rawArgs) {
      const args = argsOf(rawArgs);
      return json(await writes.deleteFile(pathOf(args)));
    },
  };
}
