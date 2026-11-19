// Source Control's one-shot commit-message generator (D-197).
//
// This is the first model call in the IDE that is not a chat turn. It reads the commit's own
// scope (staged -> HEAD vs index, otherwise index vs working tree, the same rule Source Control
// applies when it stages everything and commits), sends one bounded prompt through the chat's
// configured model, and returns the normalized message. It writes neither source nor history:
// the caller only fills the textarea, and the user commits.
//
// Ports are injected (the call/loadSettings seams of chat-session.ts) so tests exercise the
// scope rule, the truncation marker and the failure path without a controller or a network.
// Nothing here throws: every failure comes back as data, because the click site is a UI action.

import type { Locale } from "@/i18n";
import type { GitChange } from "@/vv/scm-session";
import type { CallModelInput, CallModelResult } from "./client";
import { MAX_DIFF_FILES, composeDiff } from "./git-common";
import type { RepoContents } from "./git-repo";
import {
  buildCommitSystemPrompt,
  buildCommitUserPrompt,
  normalizeCommitMessage,
  type CommitPromptInput,
} from "./prompt-commit";
import { isConfigured } from "./settings";
import type { AiSettings } from "./types";

/** The prompt keeps the start of a large diff; composeDiff has already applied the git caps. */
export const MAX_PROMPT_DIFF_CHARS = 12_000;

/** The explicit marker a truncated payload carries, so the model never claims full coverage. */
export const TRUNCATION_MARKER = "\n[diff truncated: only part of the changes is shown]";

/** The commit's changed files: staged wins because doCommit stages everything when it is empty. */
export interface CommitScope {
  readonly root: string;
  readonly staged: readonly GitChange[];
  readonly changes: readonly GitChange[];
}

export interface CommitGenerationRequest {
  readonly scope: CommitScope;
  /** Aborted when the panel unmounts or the user starts another generation. */
  readonly signal?: AbortSignal;
}

export interface CommitGenerationFailure {
  readonly reason: "unconfigured" | "empty" | "aborted" | "failed";
  /** The provider's technical detail, when there is one (never translated). */
  readonly message?: string;
}

export type CommitGenerationResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly failure: CommitGenerationFailure };

/** The narrow seams: the chat's model, the locale, and the git content reads. */
export interface CommitGenerationPorts {
  loadSettings(): AiSettings | null;
  call(input: CallModelInput): Promise<CallModelResult>;
  locale(): Locale;
  contents: Pick<RepoContents, "head" | "index" | "workdir">;
}

export interface CommitGenerator {
  generate(request: CommitGenerationRequest): Promise<CommitGenerationResult>;
}

function failure(
  reason: CommitGenerationFailure["reason"],
  message?: string,
): CommitGenerationResult {
  return message === undefined
    ? { ok: false, failure: { reason } }
    : { ok: false, failure: { reason, message } };
}

/** Cap the prompt payload and make truncation visible in the text the model reads. */
export function boundCommitPayload(input: CommitPromptInput): CommitPromptInput {
  const over = input.diff.length > MAX_PROMPT_DIFF_CHARS;
  if (!over && !input.truncated) return input;
  const diff = over ? input.diff.slice(0, MAX_PROMPT_DIFF_CHARS) : input.diff;
  return { files: input.files, diff: diff + TRUNCATION_MARKER, truncated: true };
}

/**
 * Read the commit's scope and compose the bounded payload: the staged changes are HEAD vs
 * index, an empty index falls back to index vs working tree. The paths and the diff go
 * through the same composeDiff renderer as git_diff, so the message and the tool never differ.
 */
export async function readCommitScope(
  scope: CommitScope,
  contents: Pick<RepoContents, "head" | "index" | "workdir">,
): Promise<CommitPromptInput> {
  const staged = scope.staged.length > 0;
  const changes = staged ? scope.staged : scope.changes;
  const paths = changes.slice(0, MAX_DIFF_FILES).map((change) => change.path);
  const before = staged
    ? await contents.head(scope.root, paths)
    : await contents.index(scope.root, paths);
  const after = staged
    ? await contents.index(scope.root, paths)
    : await contents.workdir(scope.root, paths);
  const composed = composeDiff(paths, before, after, changes.length > paths.length);
  return boundCommitPayload({
    files: paths,
    diff: composed.diff,
    truncated: composed.truncated,
  });
}

export function createCommitGenerator(ports: CommitGenerationPorts): CommitGenerator {
  return {
    async generate(request) {
      try {
        if (request.signal?.aborted) return failure("aborted");
        const settings = ports.loadSettings();
        if (settings === null || !isConfigured(settings)) return failure("unconfigured");
        if (request.scope.staged.length === 0 && request.scope.changes.length === 0) {
          return failure("empty");
        }

        const payload = await readCommitScope(request.scope, ports.contents);
        if (request.signal?.aborted) return failure("aborted");

        const result = await ports.call({
          settings,
          system: buildCommitSystemPrompt(ports.locale()),
          messages: [{ role: "user", content: buildCommitUserPrompt(payload) }],
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        if (!result.ok) {
          if (result.failure.kind === "aborted") return failure("aborted");
          return failure("failed", result.failure.message);
        }

        const message = normalizeCommitMessage(result.text);
        return message === "" ? failure("empty") : { ok: true, message };
      } catch (error) {
        // The click site must never see a rejection: the panel shows the failure inline.
        return failure("failed", error instanceof Error ? error.message : String(error));
      }
    },
  };
}
