// framework_reference: the on-demand half of the framework knowledge (D-182).
//
// The system prompt carries only frameworkIndex() (module ids and entry names); this tool
// returns the signatures and examples for the module/query the model actually needs. Like
// the other PTC read tools it is thin: it validates arguments and the seam does the lookup.
// A refused call is a PtcToolError; an unknown module is DATA (empty matches) so the model
// can retry instead of treating it as a crash.

import type {
  FrameworkAccess,
  FrameworkEntryWithModule,
  FrameworkReferenceResult,
} from "../framework-reference";
import type { RuntimeToolHandler } from "./graph-tools";
import { PtcToolError, type PtcJson } from "./protocol";

/** The router host slice: the tool family exists exactly when the reference seam does. */
export interface FrameworkToolHost {
  readonly framework?: FrameworkAccess;
}

type Args = Record<string, unknown>;

/** A lookup argument is a filter, not a payload: anything longer is malformed. */
const MAX_FILTER_CHARS = 200;

/** The response budget, not the lookup cap: 8 KB of JSON is already a lot of reference text. */
const MAX_RESPONSE_CHARS = 8 * 1024;

/** Room for the {"matches":[],"truncated":false} envelope inside the budget. */
const ENVELOPE_RESERVE = 256;

function refuse(message: string): never {
  throw new PtcToolError("capability", message);
}

function argsOf(value: unknown): Args {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    refuse(
      "arguments must be one JSON object, e.g. tools.framework_reference({ module: 'db', query: 'tenant' })",
    );
  }
  return value as Args;
}

function filterOf(args: Args, key: "module" | "query"): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > MAX_FILTER_CHARS) {
    refuse(key + " must be a string of at most " + MAX_FILTER_CHARS + " characters");
  }
  // An empty filter means "no filter"; an empty module cannot name anything.
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** The seam returns plain JSON objects; the round trip keeps the sandbox boundary honest. */
function json(value: unknown): PtcJson {
  return JSON.parse(JSON.stringify(value)) as PtcJson;
}

/**
 * Cap the serialized size as well as the entry count: a handful of long signatures can
 * exceed 8 KB before the entry cap is reached, and the model gains nothing from a wall of
 * text it cannot fit in context.
 */
function bounded(result: FrameworkReferenceResult): FrameworkReferenceResult {
  const matches: FrameworkEntryWithModule[] = [];
  let chars = 0;
  for (const match of result.matches) {
    const size = JSON.stringify(match).length;
    if (chars + size > MAX_RESPONSE_CHARS - ENVELOPE_RESERVE) {
      return { matches, truncated: true };
    }
    matches.push(match);
    chars += size;
  }
  return { matches, truncated: result.truncated };
}

export function createFrameworkToolHandlers(
  host: FrameworkToolHost,
): Readonly<Record<string, RuntimeToolHandler>> {
  const framework = host.framework;
  if (framework === undefined) return {};
  return {
    async framework_reference(rawArgs) {
      const args = argsOf(rawArgs);
      const module = filterOf(args, "module");
      const query = filterOf(args, "query");
      const result = framework.reference({
        ...(module === undefined ? {} : { module }),
        ...(query === undefined ? {} : { query }),
      });
      return json(bounded(result));
    },
  };
}
