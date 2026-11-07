// The deterministic answer behind the dev mock provider (D-045/D-046).
//
// It is a real AIResponse payload, not prose: the same parser that handles every
// provider response handles this one, so the chat flow can be exercised without
// a key or a network call.

import type { AiChatTurn } from "./types";

// Re-exported for callers that reach the mock through its own module; the
// preset table itself lives in providers.ts.
export { MOCK_PRESET } from "./providers";

const DEMO_PATH = "src/chat-demo.ts";

// No comments and no imports: a one-line module the patch validator can accept.
const DEMO_CONTENT = 'export const chatDemo = "hello from the Facilis dev mock";\n';

/** Asking the mock for "ptc"/"esplora" exercises the PTC trace without a provider key. */
const PTC_TRIGGER = /\b(ptc|esplora)\b/i;
const PTC_SCRIPT = "return await tools.get_project_summary();";

function wantsExploration(messages: readonly AiChatTurn[]): boolean {
  return messages.some((message) => message.role === "user" && PTC_TRIGGER.test(message.content));
}

/** The follow-up call carries the assistant's script turn, so do not loop forever. */
function alreadyExplored(messages: readonly AiChatTurn[]): boolean {
  return messages.some(
    (message) => message.role === "assistant" && message.content.includes('"script"'),
  );
}

export function mockAnswer(messages: readonly AiChatTurn[]): string {
  if (wantsExploration(messages) && !alreadyExplored(messages)) {
    return JSON.stringify({
      message:
        "Mock PTC run: I read the project summary first, then I will propose the demo file. (No model was called.)",
      script: PTC_SCRIPT,
      notes: ["The dev mock never calls a provider."],
      requires_confirmation: false,
    });
  }
  const turnCount = messages.length;
  return JSON.stringify({
    message:
      "No model was called: this is the Facilis dev mock. It always proposes " +
      DEMO_PATH +
      " (" +
      turnCount +
      " chat turn(s) seen).",
    patches: [{ path: DEMO_PATH, action: "create", content: DEMO_CONTENT }],
    notes: [
      "The dev mock never calls a provider.",
      "The proposed patch is fixed and safe to apply.",
    ],
    requires_confirmation: false,
  });
}
