// Read-only tool router for the PTC program runtime (docs/PTC.md §6, D-101).
//
// A sandboxed model program asks the host for data; this module is the only place those
// requests are answered (arguments are untrusted, paths go through policy.ts, results are
// plain lossless JSON). Nothing here writes: the validated proposal + user Apply stay the
// only write path (invariant 9).

import type { Analysis, FilePatch } from "@facilis/ai";
import { fetchManifest } from "@/facilis/manifest-client";

import { validatePatchesWithHost, type PatchValidationHost } from "../patch-validation";
import { createRuntimeToolHandlers, type RuntimeToolHandler } from "./graph-tools";
import {
  assertReadablePath,
  assertSafeGlob,
  globMatcher,
  isReadablePath,
  redactSecrets,
} from "./policy";
import {
  findingsJson,
  isPtcToolError,
  PtcToolError,
  type PtcJson,
  type PtcToolCall,
  type PtcToolExecutor,
} from "./protocol";
import { SPEC_BY_NAME, TOOL_NAMES, advertisedSpecs } from "./tool-specs";

// Caps bound one program's exploration: broad listings/searches and huge files come back as
// capped data with a truncation flag, never as one giant tool result.
const MAX_LISTED_FILES = 500;
const MAX_READ_LINES = 400;
const MAX_READ_CHARS = 32_000;
const MAX_QUERY_CHARS = 200;
const MAX_SEARCH_FILES = 2_000;
const MAX_SEARCH_FILE_CHARS = 64_000;
const MAX_PREVIEW_CHARS = 200;
const MAX_PATH_CHARS = 500;
const MAX_FACT_ROWS = 100;
const MAX_PATCHES = 50;

type Args = Record<string, unknown>;
type PathMatcher = (path: string) => boolean;

interface ToolContext {
  host: PatchValidationHost;
  signal: AbortSignal | undefined;
  /** Cached per router instance: the analyzer round trip is the expensive part. */
  analysis(): Promise<Analysis>;
}

type Handler = (args: Args, context: ToolContext) => Promise<PtcJson>;

function refuse(message: string): never {
  throw new PtcToolError("capability", message);
}

function argsOf(value: unknown): Args {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    refuse("arguments must be one JSON object, e.g. tools.read_file({ path: 'db/schema.ts' })");
  }
  return value as Args;
}

function optionalString(args: Args, key: string, maxChars: number): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) {
    refuse(key + " must be a non-empty string of at most " + maxChars + " characters");
  }
  return value;
}

function optionalInteger(args: Args, key: string, min: number, max: number): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    refuse(key + " must be an integer between " + min + " and " + max);
  }
  return value;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new PtcToolError("abort", "the tool call was aborted");
}

async function readSource(context: ToolContext, path: string): Promise<string> {
  throwIfAborted(context.signal);
  try {
    return await context.host.read(path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PtcToolError("exception", "cannot read " + path + ": " + detail);
  }
}

/** Analyzer facts are plain JSON already; the round trip drops readonly markers so the value
 * crosses the sandbox boundary as PtcJson without a hand-written deep mapper. */
function plainJson(value: unknown): PtcJson {
  return JSON.parse(JSON.stringify(value)) as PtcJson;
}

/** A traversal glob is a refusal, not an empty result: silently matching nothing would hide
 * the attempt instead of reporting it. */
function globOf(args: Args): PathMatcher | null {
  const glob = optionalString(args, "glob", MAX_QUERY_CHARS);
  if (glob === undefined) return null;
  assertSafeGlob(glob);
  return globMatcher(glob);
}

function readableFiles(host: PatchValidationHost, glob: PathMatcher | null): string[] {
  return host
    .files()
    .filter(isReadablePath)
    .filter((path) => glob === null || glob(path))
    .toSorted((left, right) => left.localeCompare(right));
}

const HANDLERS: Readonly<Record<string, Handler>> = {
  async list_files(args, context) {
    const dir = optionalString(args, "dir", MAX_PATH_CHARS)?.replace(/\/+$/, "");
    if (dir !== undefined) assertReadablePath(dir);
    const prefix = dir === undefined ? "" : dir + "/";
    const files = readableFiles(context.host, globOf(args)).filter((path) =>
      path.startsWith(prefix),
    );
    return { files: files.slice(0, MAX_LISTED_FILES), truncated: files.length > MAX_LISTED_FILES };
  },
  async read_file(args, context) {
    const path = optionalString(args, "path", MAX_PATH_CHARS);
    if (path === undefined) refuse("path is required");
    assertReadablePath(path);
    const startLine = optionalInteger(args, "startLine", 1, 1_000_000) ?? 1;
    const requestedEnd = optionalInteger(args, "endLine", 1, 1_000_000);
    if (requestedEnd !== undefined && requestedEnd < startLine)
      refuse("endLine must not be less than startLine");
    const lines = (await readSource(context, path)).split("\n");
    if (lines.at(-1) === "") lines.pop(); // a trailing newline is not a line
    const totalLines = lines.length;
    const end = Math.min(requestedEnd ?? totalLines, startLine + MAX_READ_LINES - 1, totalLines);
    const selected = lines.slice(startLine - 1, end);
    // Redact before the char cap: a secret cut in half at the boundary would slip through.
    const redacted = redactSecrets(selected.join("\n"));
    return {
      path,
      content: redacted.slice(0, MAX_READ_CHARS),
      startLine,
      endLine: startLine + selected.length - 1,
      totalLines,
      truncated: redacted.length > MAX_READ_CHARS || end < totalLines,
    };
  },
  async search(args, context) {
    const query = optionalString(args, "query", MAX_QUERY_CHARS);
    if (query === undefined) refuse("query is required");
    if (query.length < 3) refuse("query must be at least 3 characters");
    const limit = optionalInteger(args, "maxResults", 1, 100) ?? 50;
    const needle = query.toLowerCase();
    const matches: PtcJson[] = [];
    const files = readableFiles(context.host, globOf(args));
    for (const [fileIndex, path] of files.entries()) {
      if (matches.length >= limit) break;
      if (fileIndex >= MAX_SEARCH_FILES) return { matches, truncated: true };
      throwIfAborted(context.signal);
      // Best effort (an unreadable file is skipped) and sequential so caps/abort can stop.
      // oxlint-disable-next-line no-await-in-loop
      const content = await context.host.read(path).catch(() => "");
      const lines = content.slice(0, MAX_SEARCH_FILE_CHARS).split("\n");
      for (const [index, line] of lines.entries()) {
        const at = line.toLowerCase().indexOf(needle);
        if (at === -1) continue;
        // Window a long line around the hit so the match stays visible in the preview.
        const start = Math.max(0, at - 80);
        const preview = line.slice(start, start + MAX_PREVIEW_CHARS).trim();
        matches.push({ path, line: index + 1, preview });
        if (matches.length >= limit) {
          return { matches, truncated: index < lines.length - 1 || fileIndex < files.length - 1 };
        }
      }
    }
    return { matches, truncated: false };
  },
  async get_schema(args, context) {
    const name = optionalString(args, "table", MAX_PATH_CHARS);
    const tables = (await context.analysis()).tables.filter(
      (table) => name === undefined || table.name === name,
    );
    return {
      tables: tables.slice(0, MAX_FACT_ROWS).map(plainJson),
      truncated: tables.length > MAX_FACT_ROWS,
    };
  },
  async get_routes(args, context) {
    const prefix = optionalString(args, "prefix", MAX_PATH_CHARS);
    // Route paths are URLs, not file paths, so the project-path policy does not apply here.
    const routes = (await context.analysis()).routes.filter(
      (route) => prefix === undefined || route.path.startsWith(prefix),
    );
    return {
      routes: routes.slice(0, MAX_FACT_ROWS).map(plainJson),
      truncated: routes.length > MAX_FACT_ROWS,
    };
  },
  async get_config(_args, context) {
    return plainJson((await context.analysis()).config);
  },
  async get_manifest(_args, context) {
    const base = context.host.manifestBase();
    if (base === null) return { available: false };
    const result = await fetchManifest(base, { signal: context.signal });
    // Fail safe: a booting or unreachable project is data the model can retry, not an error.
    if (!result.ok) return { available: false, error: result.error };
    return plainJson({ available: true, ...result.envelope });
  },
  async get_project_summary(_args, context) {
    const facts = await context.analysis();
    return {
      files: facts.files.length,
      routes: facts.routes.length,
      tables: facts.tables.length,
      pages: facts.pages.length,
      names: {
        tables: facts.tables.slice(0, MAX_FACT_ROWS).map((table) => table.name),
        routes: facts.routes.slice(0, MAX_FACT_ROWS).map((r) => `${r.method} ${r.path}`),
        pages: facts.pages.slice(0, MAX_FACT_ROWS).map((page) => page.path),
      },
    };
  },
  async validate(args, context) {
    const patches = patchesArg(args["patches"]);
    const requiresConfirmation = args["requiresConfirmation"];
    if (requiresConfirmation !== undefined && typeof requiresConfirmation !== "boolean")
      refuse("requiresConfirmation must be a boolean");
    throwIfAborted(context.signal);
    // Exactly the final-gate function, so the self-check can never disagree with Apply.
    const result = await validatePatchesWithHost(patches, context.host, {
      ...(requiresConfirmation === undefined ? {} : { requiresConfirmation }),
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    });
    return {
      ok: result.validation.ok,
      errors: findingsJson(result.validation.errors),
      warnings: findingsJson(result.validation.warnings),
    };
  },
};

function patchesArg(value: unknown): FilePatch[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PATCHES) {
    refuse("patches must be a non-empty array of at most " + MAX_PATCHES);
  }
  return value.map((entry: unknown, index: number) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      refuse("patch " + index + " must be an object");
    }
    const { path, action, content } = entry as Args;
    if (typeof path !== "string" || path.length === 0)
      refuse("patch " + index + " needs a non-empty path");
    if (action !== "create" && action !== "update" && action !== "delete")
      refuse("patch " + index + " action must be create, update or delete");
    if (content !== undefined && typeof content !== "string")
      refuse("patch " + index + " content must be a string");
    return { path, action, ...(content === undefined ? {} : { content }) };
  });
}

export function createToolRouter(host: PatchValidationHost): PtcToolExecutor {
  let facts: Promise<Analysis> | null = null;
  const analysis = (): Promise<Analysis> =>
    (facts ??= host.analyze([]).then((result) => result.after));
  // D-111/D-126: the preview and graph tools exist only when the IDE provides them.
  const extras = createRuntimeToolHandlers(host);
  return {
    specs: () => advertisedSpecs(host.preview !== undefined, host.graph !== undefined),
    async execute(call: PtcToolCall, options: { signal?: AbortSignal }): Promise<PtcJson> {
      const spec = SPEC_BY_NAME.get(call.name);
      if (spec === undefined) refuse("unknown tool: " + call.name + "; available: " + TOOL_NAMES);
      throwIfAborted(options.signal);
      try {
        const extra: RuntimeToolHandler | undefined = extras[call.name];
        if (extra !== undefined) return await extra(argsOf(call.args));
        const handler: Handler | undefined = HANDLERS[call.name];
        if (handler === undefined) refuse("tool is not implemented: " + call.name);
        return await handler(argsOf(call.args), { host, signal: options.signal, analysis });
      } catch (error) {
        if (isPtcToolError(error)) {
          // The model reads this text: name the tool and its signature so a wrong call is
          // self-correcting instead of a bare "path must be a non-empty string".
          throw new PtcToolError(
            error.kind,
            spec.name + " " + spec.signature + ": " + error.message,
          );
        }
        throw error;
      }
    },
  };
}
