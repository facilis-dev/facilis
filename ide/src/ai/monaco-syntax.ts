// Rule 1's parser in the IDE: Monaco's TypeScript worker (D-084).
//
// @facilis/ai is browser-safe and never imports typescript, so the IDE injects this
// checker instead. It parses the patched source as an in-memory Monaco model and asks the
// SAME language service the editor uses for its syntactic diagnostics — no project model
// is swapped and the user's open buffers are never touched. Semantic (type) diagnostics
// are deliberately not part of the gate: an in-memory file has no real module graph and
// type-checking the whole project at review time is the editor's job, not the validator's.
// A service that cannot answer fails closed (the caller turns the rejection into a
// rule-1 error), never silently passes.

import type { SyntaxChecker, SyntaxIssue } from "@facilis/ai";
import type * as Monaco from "monaco-editor";

export interface MonacoSyntaxHost {
  editorSession: {
    ensureMonaco(): Promise<typeof Monaco>;
  };
}

/**
 * The editor tears its TypeScript worker down and re-creates it when the project's
 * dependency types finish loading (editor-language.ts `applyExtraLibs`), and a worker
 * request that lands in that window can never answer: `getTypeScriptWorker()` resolves but
 * `worker(uri)` waits for a worker that is being replaced. That window is seconds long on
 * a cold project and invisible from the caller, so each attempt is bounded and retried
 * until the new language service answers; a genuine hang still fails closed.
 */
const ATTEMPT_TIMEOUT_MS = 2_500;
const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, what: string, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Timed out " + what)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let sequence = 0;

function languageOf(path: string): string {
  return path.endsWith(".js") ||
    path.endsWith(".jsx") ||
    path.endsWith(".mjs") ||
    path.endsWith(".cjs")
    ? "javascript"
    : "typescript";
}

interface MessageChain {
  messageText: string;
  next?: readonly MessageChain[];
}

function flattenMessage(message: string | MessageChain): string {
  if (typeof message === "string") return message;
  const parts = [message.messageText];
  for (const next of message.next ?? []) parts.push(flattenMessage(next));
  return parts.join(" ");
}

interface WorkerClient {
  getSyntacticDiagnostics(fileName: string): Promise<
    readonly {
      start?: number;
      messageText: string | MessageChain;
    }[]
  >;
}

type MonacoApi = Awaited<ReturnType<MonacoSyntaxHost["editorSession"]["ensureMonaco"]>>;

async function issuesFor(monaco: MonacoApi, path: string, content: string): Promise<SyntaxIssue[]> {
  sequence += 1;
  // A dedicated in-memory URI per call: it never collides with a project model and
  // disposing it leaves the editor state untouched.
  const suffix = path.replace(/[^A-Za-z0-9_.-]+/g, "_");
  const uri = monaco.Uri.parse("inmemory://facilis-validation/" + sequence + "/" + suffix);
  const model = monaco.editor.createModel(content, languageOf(path), uri);
  try {
    const worker = await monaco.typescript.getTypeScriptWorker();
    const client = (await worker(uri)) as unknown as WorkerClient;
    const diagnostics = await client.getSyntacticDiagnostics(uri.toString());
    const issues: SyntaxIssue[] = [];
    for (const diagnostic of Array.isArray(diagnostics) ? diagnostics : []) {
      const position = model.getPositionAt(
        typeof diagnostic.start === "number" ? diagnostic.start : 0,
      );
      issues.push({
        line: position.lineNumber,
        column: position.column,
        message: flattenMessage(diagnostic.messageText),
      });
    }
    return issues;
  } finally {
    model.dispose();
  }
}

/**
 * Try a bounded attempt, and retry while the language service is unavailable or being
 * re-created (the lazy registration and the worker restart both look like a timeout). A
 * parse problem is a diagnostic, never a rejection, so every rejection here is
 * "service not answering" and worth one more attempt.
 */
async function diagnose(monaco: MonacoApi, path: string, content: string): Promise<SyntaxIssue[]> {
  let lastError: Error = new Error("The TypeScript service did not answer.");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await withTimeout(
        issuesFor(monaco, path, content),
        "parsing the patched file",
        ATTEMPT_TIMEOUT_MS,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_ATTEMPTS - 1) await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

/** A SyntaxChecker backed by Monaco's TypeScript worker. */
export function createMonacoSyntaxChecker(host: MonacoSyntaxHost): SyntaxChecker {
  return {
    async check(path, content) {
      const monaco = await host.editorSession.ensureMonaco();
      return diagnose(monaco, path, content);
    },
  };
}
