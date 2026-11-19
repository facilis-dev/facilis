// The Conventional Commits prompt of Source Control's commit box (D-197).
//
// The box asks one model call for a message and shows it in the textarea: the user still
// commits, so this module only decides WHAT we ask for and HOW the answer is cleaned up.
// Conventional Commits are this repository's convention (AGENTS.md): an English type(scope)
// prefix and a summary in the IDE's locale. Kept separate from commit-generation.ts so the
// prompt wording is testable without the git/model seams (and each file stays under 300 lines).

import type { Locale } from "@/i18n";

/** The longest message the box accepts; a longer answer is cut at a line boundary. */
export const MAX_COMMIT_MESSAGE_CHARS = 2000;

const LANGUAGE: Record<Locale, string> = { en: "English", it: "Italian" };

/** What the model is asked to read: the commit's file list and bounded unified diff. */
export interface CommitPromptInput {
  readonly files: readonly string[];
  readonly diff: string;
  readonly truncated: boolean;
}

const CONVENTIONAL_HEADER =
  /^(?:feat|fix|chore|docs|test|refactor|perf|build|ci|style|revert)(?:\([^)\n]*\))?!?:[ \t]+\S/;

/** The one-paragraph contract: a Conventional Commit in the IDE's language, message only. */
export function buildCommitSystemPrompt(locale: Locale): string {
  return [
    "You write git commit messages for a software project.",
    "The repository follows Conventional Commits: type(scope): summary.",
    "type is one of feat, fix, chore, docs, test, refactor, perf, build, ci, style, revert and stays English.",
    "scope is optional, a short English noun for the area; never write empty parentheses.",
    "The summary is imperative, lower-case and has no trailing period.",
    "Add a body only when it adds information the summary does not carry (why, not what); separate it with one blank line.",
    "Write the description in " +
      LANGUAGE[locale] +
      "; the type(scope): prefix stays English even when the description is not.",
    "Never add AI attribution or Co-authored-by lines, and never invent ticket ids or issue numbers.",
    "Reply with the commit message only: no code fences, no preamble, no quotes, no explanation.",
  ].join("\n");
}

/** The user turn: the changed files, the truncation warning, then the diff itself. */
export function buildCommitUserPrompt(input: CommitPromptInput): string {
  const files =
    input.files.length === 0 ? "(none)" : input.files.map((path) => "- " + path).join("\n");
  const warning = input.truncated
    ? "The diff is truncated: it does not show every change, so do not claim to have reviewed all of it.\n\n"
    : "";
  return (
    "Files in this commit:\n" +
    files +
    "\n\n" +
    warning +
    "Unified diff:\n" +
    input.diff
  );
}

/** Offset of the first line that starts with a Conventional-Commit header, or -1. */
function headerOffset(text: string): number {
  let offset = 0;
  for (const line of text.split("\n")) {
    if (CONVENTIONAL_HEADER.test(line.trim())) return offset;
    offset += line.length + 1;
  }
  return -1;
}

function stripFence(text: string): string {
  const fenced = /\x60\x60\x60[a-zA-Z0-9_-]*[ \t]*\n?([\s\S]*?)\n?\x60\x60\x60/.exec(text);
  if (fenced?.[1] !== undefined) return fenced[1].trim();
  // An unterminated fence is still not part of the message.
  return text
    .replace(/^\x60\x60\x60[a-zA-Z0-9_-]*[ \t]*\n?/, "")
    .replace(/\n?\x60\x60\x60[ \t]*$/, "")
    .trim();
}

function capMessage(text: string): string {
  const cut = text.slice(0, MAX_COMMIT_MESSAGE_CHARS);
  const lineBreak = cut.lastIndexOf("\n");
  // Only cut at the last line when that does not throw most of the body away.
  const bounded = lineBreak > MAX_COMMIT_MESSAGE_CHARS / 2 ? cut.slice(0, lineBreak) : cut;
  return bounded.trimEnd();
}

/**
 * Normalize what the model wrote: unwrap a fence, drop leading prose before the header,
 * unquote, remove an empty scope and a trailing period, reject empty output and cap the
 * total length. The result is the message the box shows, or "" when nothing usable came back.
 */
export function normalizeCommitMessage(raw: string): string {
  let text = stripFence(raw.trim());
  if (text === "") return "";

  const offset = headerOffset(text);
  if (offset > 0) text = text.slice(offset);
  text = text.trim();

  // A label is never part of the message ("Commit message: ...").
  text = text.replace(/^(?:commit message|messaggio(?: di commit)?|message)\s*:\s*/i, "");
  text = text.replace(/^[\s"'\x60]+|[\s"'\x60]+$/g, "");
  text = text.replace(/\r\n/g, "\n").trim();
  if (text === "") return "";

  const lines = text.split("\n");
  const header = (lines[0] ?? "")
    .replace(/^([a-z]+)\(\s*\)/, "$1")
    .replace(/[ \t]+$/, "")
    .replace(/\.$/, "");
  lines[0] = header;
  text = lines
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();
  if (text === "") return "";
  return text.length > MAX_COMMIT_MESSAGE_CHARS ? capMessage(text) : text;
}
