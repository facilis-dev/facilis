// The git tool handlers (D-139): what the model may do to the project's repository.
//
// Arguments come from an untrusted sandboxed program, so they are validated here before
// git-access.ts touches the repository. A wrong call is a PtcToolError naming the field and the
// signature (the router prefixes those), so the model can retry correctly. "No project is open"
// is data (available: false), like the preview and graph families.
//
// Allowlists, not field picking: unknown fields are refused, which is also how a token argument
// can never be smuggled in — the tools use only the tab's signed-in GitHub account (D-082).

import type { GitAccess } from "../git-access";
import type { RuntimeToolHandler } from "./graph-tools";
import { PtcToolError, type PtcJson } from "./protocol";

type Args = Record<string, unknown>;

const MAX_PATH = 500;
const MAX_PATHS = 500;
const MAX_MESSAGE = 4_000;
const MAX_NAME = 100;
const MAX_TITLE = 256;
const MAX_BODY = 8_000;
const MAX_LOG_LIMIT = 30;

/** Per-tool field allowlists; the order is the signature order the prompt shows. */
const FIELDS = {
  git_status: [],
  git_diff: ["path", "staged"],
  git_log: ["limit"],
  git_branches: [],
  git_remote: [],
  git_stage: ["paths"],
  git_unstage: ["paths"],
  git_commit: ["message"],
  git_branch: ["action", "name"],
  git_sync: ["action"],
  git_pull_request: ["title", "body", "base", "head", "draft"],
} as const;

type ToolName = keyof typeof FIELDS;

function refuse(message: string): never {
  throw new PtcToolError("capability", message);
}

function isRecord(value: unknown): value is Args {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SECRET_FIELDS = new Set(["token", "access_token", "password", "credentials", "secret"]);

/** Validate the argument object itself: one JSON object with only the tool's fields. */
function argsOf(value: unknown, tool: ToolName): Args {
  const fields: readonly string[] = FIELDS[tool];
  if (value === undefined || value === null) return {};
  if (!isRecord(value))
    refuse(tool + " takes ONE JSON object argument, e.g. tools." + tool + "({})");
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    if (SECRET_FIELDS.has(key)) {
      refuse(
        "there is no " +
          key +
          " argument: the tools read the tab's signed-in GitHub account (Source Control -> Remote git) and never accept a token, password or secret you pass",
      );
    }
    refuse(
      "unknown field " +
        JSON.stringify(key) +
        "; " +
        tool +
        " accepts " +
        (fields.length === 0 ? "no arguments" : fields.join(", ")),
    );
  }
  return value;
}

function requiredString(args: Args, key: string, max: number): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    refuse(key + " must be a non-empty string of at most " + max + " characters");
  }
  return value;
}

function optionalString(args: Args, key: string, max: number): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    refuse(key + " must be a non-empty string of at most " + max + " characters");
  }
  return value;
}

function optionalBoolean(args: Args, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") refuse(key + " must be a boolean");
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

/** A repo-relative path: never absolute, never escaping the project, never a `.git` path. */
function repoPathOf(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH) {
    refuse(
      field + " must be a non-empty repo-relative path of at most " + MAX_PATH + " characters",
    );
  }
  const segments = value.split("/");
  if (
    value.startsWith("/") ||
    value.includes("\0") ||
    segments.some((segment) => segment === ".." || segment === "." || segment === ".git") ||
    segments[0] === ".git"
  ) {
    refuse(field + ' must stay inside the project, e.g. "src/App.tsx"');
  }
  return value;
}

function pathsOf(args: Args): readonly string[] {
  const value = args["paths"];
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PATHS) {
    refuse("paths must be a non-empty array of at most " + MAX_PATHS + " repo-relative paths");
  }
  return value.map((entry, index) => repoPathOf(entry, "paths[" + index + "]"));
}

function optionalPathsOf(args: Args): readonly string[] | undefined {
  if (args["paths"] === undefined) return undefined;
  return pathsOf(args);
}

const BRANCH_RE =
  /^(?!-)(?!.*\.\.)(?!.*@\{)(?!.*\/\/)(?!.*\/$)(?!.*\.lock$)[A-Za-z0-9._/-]{1,100}$/;

function branchNameOf(args: Args, key: string): string {
  const value = requiredString(args, key, MAX_NAME);
  if (!BRANCH_RE.test(value)) {
    refuse(
      key +
        " must be a valid branch name: letters, digits, '.', '_', '-' or '/' (no spaces, no '..', not starting with '-')",
    );
  }
  return value;
}

function actionOf<T extends string>(args: Args, allowed: readonly T[]): T {
  const value = args["action"];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    refuse("action must be one of " + allowed.map((entry) => JSON.stringify(entry)).join(", "));
  }
  return value as T;
}

function unavailable(): PtcJson {
  return { available: false, reason: "no project is open: open a project, then retry" };
}

export function createGitHandlers(access: GitAccess): Record<string, RuntimeToolHandler> {
  return {
    async git_status(args) {
      argsOf(args, "git_status");
      return access.available() ? access.status() : unavailable();
    },

    async git_diff(args) {
      const parsed = argsOf(args, "git_diff");
      if (!access.available()) return unavailable();
      const path = parsed["path"] === undefined ? undefined : repoPathOf(parsed["path"], "path");
      return access.diff({
        ...(path === undefined ? {} : { path }),
        staged: optionalBoolean(parsed, "staged") ?? false,
      });
    },

    async git_log(args) {
      const parsed = argsOf(args, "git_log");
      if (!access.available()) return unavailable();
      return access.log(optionalInteger(parsed, "limit", 1, MAX_LOG_LIMIT));
    },

    async git_branches(args) {
      argsOf(args, "git_branches");
      return access.available() ? access.branches() : unavailable();
    },

    async git_remote(args) {
      argsOf(args, "git_remote");
      return access.available() ? access.remote() : unavailable();
    },

    async git_stage(args) {
      const paths = pathsOf(argsOf(args, "git_stage"));
      return access.available() ? access.stage(paths) : unavailable();
    },

    async git_unstage(args) {
      const paths = optionalPathsOf(argsOf(args, "git_unstage"));
      if (!access.available()) return unavailable();
      return paths === undefined ? access.unstage() : access.unstage(paths);
    },

    async git_commit(args) {
      const message = requiredString(argsOf(args, "git_commit"), "message", MAX_MESSAGE);
      return access.available() ? access.commit(message) : unavailable();
    },

    async git_branch(args) {
      const parsed = argsOf(args, "git_branch");
      const action = actionOf(parsed, ["create", "switch"] as const);
      const name = branchNameOf(parsed, "name");
      return access.available() ? access.branch(action, name) : unavailable();
    },

    async git_sync(args) {
      const action = actionOf(argsOf(args, "git_sync"), ["fetch", "pull", "push"] as const);
      return access.available() ? access.sync(action) : unavailable();
    },

    async git_pull_request(args) {
      const parsed = argsOf(args, "git_pull_request");
      const title = requiredString(parsed, "title", MAX_TITLE);
      const body = optionalString(parsed, "body", MAX_BODY);
      const base = parsed["base"] === undefined ? undefined : branchNameOf(parsed, "base");
      const head = parsed["head"] === undefined ? undefined : branchNameOf(parsed, "head");
      const draft = optionalBoolean(parsed, "draft");
      if (!access.available()) return unavailable();
      return access.pullRequest({
        title,
        ...(body === undefined ? {} : { body }),
        ...(base === undefined ? {} : { base }),
        ...(head === undefined ? {} : { head }),
        ...(draft === undefined ? {} : { draft }),
      });
    },
  };
}
