// The chat's public contracts and shared helpers.
//
// Split out of chat-session.ts, which is at the 300-line limit: the session class
// owns behaviour, these are the shapes the host, the tests and the UI agree on.

import type { Analysis, FilePatch, SyntaxChecker } from "@facilis/ai";
import type { PatchBridge } from "@/facilis/apply-patch";
import type { PreviewAccess } from "./preview-access";
import type { CallModelInput, CallModelResult } from "./client";
import type { PtcRunner } from "./ptc/protocol";
import { isConfigured } from "./settings";
import type { AiChatTurn, AiSettings, ChatMessage, ChatState } from "./types";

/** What the chat needs from the editor, all in project-relative terms. */
export interface ChatHost {
  /** Absolute VFS path of the open project, or null. */
  root(): string | null;
  bridge: PatchBridge;
  /** Project-relative paths of every file in the project. */
  files(): readonly string[];
  /** Read a project-relative file; "" when it does not exist. */
  read(path: string): Promise<string>;
  /** The file open in the editor, with unsaved buffer content when it is available. */
  activeFile(): Promise<{ path: string; content: string } | null>;
  /** Preview base URL used for /__facilis/manifest, or null when nothing runs. */
  manifestBase(): string | null;
  /** Rule 1's parser: the analyzer worker (oxc); null when it cannot answer (fails closed). */
  syntaxChecker?(): SyntaxChecker | null;
  /** The running preview, when the IDE has one (D-111): the preview tools drive the app. */
  preview?: PreviewAccess;
  /**
   * Analyze the project before and after a patch set (the browser analyzer worker). The
   * validator fails closed when this throws, so unanalyzed patches never reach disk.
   */
  analyze(
    patches: readonly FilePatch[],
    signal?: AbortSignal,
  ): Promise<{ before: Analysis; after: Analysis }>;
  /** Reveal a project-relative path in the editor. */
  openFile(path: string): void;
}

export type ModelCall = (input: CallModelInput) => Promise<CallModelResult>;

export interface ChatSessionOptions {
  /** Injected by the tests; the real provider client by default. */
  call?: ModelCall;
  loadSettings?: () => AiSettings | null;
  saveSettings?: (settings: AiSettings) => void;
  now?: () => number;
  /** The PTC tool runtime (D-101). The chat has no non-PTC mode (D-103). */
  runner: PtcRunner;
}

/** The turns replayed to the model on the next message (SPEC §9.1 Model A). */
export function replayTurns(messages: readonly ChatMessage[], limit: number): AiChatTurn[] {
  const turns: AiChatTurn[] = [];
  for (const message of messages.filter((entry) => entry.content.length > 0).slice(-limit)) {
    // A failed turn leaves consecutive user messages (its answer never became a bubble);
    // Anthropic rejects non-alternating roles, so fold them into one turn.
    const last = turns.at(-1);
    if (last === undefined || last.role !== message.role) {
      turns.push({ role: message.role, content: message.content });
      continue;
    }
    last.content = last.content + "\n\n" + message.content;
  }
  return turns;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** State a new turn clears: the transcript keeps its trace after a finished turn. */
export const TURN_RESET: Pick<
  ChatState,
  "repair" | "trace" | "exploring" | "patchParts" | "reasoning"
> = {
  repair: null,
  trace: [],
  exploring: null,
  patchParts: null,
  reasoning: null,
};

/** State a finished turn clears without dropping the visible trace. */
export const TURN_IDLE: Pick<ChatState, "repair" | "exploring" | "patchParts" | "reasoning"> = {
  repair: null,
  exploring: null,
  patchParts: null,
  reasoning: null,
};

export function initialState(settings: AiSettings | null): ChatState {
  return {
    phase: "idle",
    messages: [],
    proposal: null,
    applied: null,
    undo: null,
    streaming: false,
    ...TURN_RESET,
    error: null,
    settings,
    configured: isConfigured(settings),
    context: null,
  };
}
