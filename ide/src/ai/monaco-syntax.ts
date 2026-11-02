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
 * The TypeScript mode registers itself lazily on the first model of its language, so the
 * very first validation can race that registration. Retry only that specific failure (a
 * genuine parse error is a diagnostic, never a rejection), then surface the error — the
 * caller fails closed.
 */
async function diagnose(
  monaco: MonacoApi,
  path: string,
  content: string,
  attempt: number,
): Promise<SyntaxIssue[]> {
  try {
    return await issuesFor(monaco, path, content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (attempt >= 2 || !/not registered/i.test(message)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return diagnose(monaco, path, content, attempt + 1);
  }
}

/** A SyntaxChecker backed by Monaco's TypeScript worker. */
export function createMonacoSyntaxChecker(host: MonacoSyntaxHost): SyntaxChecker {
  return {
    async check(path, content) {
      const monaco = await host.editorSession.ensureMonaco();
      return diagnose(monaco, path, content, 0);
    },
  };
}
