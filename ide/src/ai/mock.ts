// The deterministic answer behind the dev mock provider (D-045/D-046).
//
// It is a real AIResponse payload, not prose: the same parser that handles every provider
// response handles this one, so the chat flow can be exercised without a key or a network
// call. It demonstrates the real write path (D-192): a first script calls write_file, the
// clean-tree gate may pause, the retry writes the demo file, and the final answer is the
// summary. The side call that generates the commit message answers with a plain sentence.

import type { AiChatTurn } from "./types";

// Re-exported for callers that reach the mock through its own module; the
// preset table itself lives in providers.ts.
export { MOCK_PRESET } from "./providers";

const DEMO_PATH = "src/chat-demo.ts";

// No comments and no imports: a one-line module the validator accepts.
const DEMO_CONTENT = 'export const chatDemo = "hello from the Facilis dev mock";\n';

/** Asking the mock for "ptc"/"esplora" exercises the PTC trace without a provider key. */
const PTC_TRIGGER = /\b(ptc|esplora)\b/i;
const PTC_SCRIPT = "return await tools.get_project_summary();";

const WRITE_SCRIPT =
  "return await tools.write_file({ path: " +
  JSON.stringify(DEMO_PATH) +
  ", content: " +
  JSON.stringify(DEMO_CONTENT) +
  " });";

function wantsExploration(messages: readonly AiChatTurn[]): boolean {
  return messages.some((message) => message.role === "user" && PTC_TRIGGER.test(message.content));
}

/** The follow-up call carries the assistant's script turn, so do not loop forever. */
function alreadyExplored(messages: readonly AiChatTurn[]): boolean {
  return messages.some(
    (message) => message.role === "assistant" && message.content.includes('"script"'),
  );
}

/** The write step's "clean now, re-issue" notice: the write must be retried after the commit. */
function cleanNotice(messages: readonly AiChatTurn[]): boolean {
  const last = messages.at(-1);
  return last?.role === "user" && last.content.includes("working tree is clean");
}

/** The write script is already in the transcript: the next call is the final answer. */
function wroteDemo(messages: readonly AiChatTurn[]): boolean {
  return messages.some(
    (message) => message.role === "assistant" && message.content.includes("tools.write_file"),
  );
}

/** The gate's summarizer call carries its own system prompt: answer with a plain sentence. */
function wantsCommitSummary(system: string | undefined): boolean {
  return system !== undefined && system.includes("You write git commit messages");
}

export function mockAnswer(messages: readonly AiChatTurn[], system?: string): string {
  if (wantsCommitSummary(system)) return "Aggiunto il file demo del mock alla pagina.";
  if (wantsExploration(messages) && !alreadyExplored(messages)) {
    return JSON.stringify({
      message: "Mock PTC run: I read the project summary first. (No model was called.)",
      script: PTC_SCRIPT,
    });
  }
  if (cleanNotice(messages)) {
    return JSON.stringify({
      message: "The tree is clean: writing the demo file.",
      script: WRITE_SCRIPT,
    });
  }
  if (!wroteDemo(messages)) {
    return JSON.stringify({
      message:
        "The dev mock writes " + DEMO_PATH + " to exercise the write tools. (No model was called.)",
      script: WRITE_SCRIPT,
    });
  }
  return JSON.stringify({
    message:
      "No model was called: this is the Facilis dev mock. It wrote " +
      DEMO_PATH +
      "; the git-changes footer shows the file and Undo removes it (" +
      messages.length +
      " chat turn(s) seen).",
  });
}
