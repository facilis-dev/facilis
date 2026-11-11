// The chat's public contracts and shared helpers.
//
// Split out of chat-session.ts, which is at the 300-line limit: the session class
// owns behaviour, these are the shapes the host, the tests and the UI agree on.

import type { Analysis, FilePatch, SyntaxChecker } from "@facilis.dev/ai";
import type { PatchBridge } from "@/facilis/apply-patch";
import type { PreviewAccess } from "./preview-access";
import type { CallModelInput, CallModelResult } from "./client";
import type { PtcRunner } from "./ptc/protocol";
import { isConfigured } from "./settings";
import type { AiChatTurn, AiSettings, ChatActivity, ChatMessage, ChatState } from "./types";

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
  /** Runs before the context is assembled (MCP discovery, D-118); must not throw. */
  prepare?(): Promise<void>;
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
  const kept = messages.filter(
    (entry) => entry.content.length > 0 || (entry.images?.length ?? 0) > 0,
  );
  for (const message of kept.slice(-limit)) {
    const images = message.images ?? [];
    // A failed turn leaves consecutive user messages (its answer never became a bubble);
    // Anthropic rejects non-alternating roles, so fold them into one turn.
    const last = turns.at(-1);
    if (last === undefined || last.role !== message.role) {
      turns.push({
        role: message.role,
        content: message.content,
        ...(images.length > 0 ? { images } : {}),
      });
      continue;
    }
    const joiner = last.content.length > 0 && message.content.length > 0 ? "\n\n" : "";
    last.content = last.content + joiner + message.content;
    // A folded turn keeps every pasted image, so the model still sees them (D-113).
    if (images.length > 0) last.images = [...(last.images ?? []), ...images];
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

/** State a finished turn clears; its activity moves onto the turn's user message (turnEnded). */
export const TURN_IDLE: Pick<ChatState, "repair" | "exploring" | "patchParts" | "reasoning"> = {
  repair: null,
  exploring: null,
  patchParts: null,
  reasoning: null,
};

/**
 * The state a finished turn leaves (success, failure or abort): the live trace is snapshotted
 * onto the user message that opened the turn, so the transcript keeps that turn in place across
 * later turns, and ChatState.trace goes back to being the live turn only.
 */
export function turnEnded(
  messages: ChatMessage[],
  userId: string,
  trace: readonly ChatActivity[],
): typeof TURN_IDLE & Pick<ChatState, "messages" | "trace"> {
  return {
    messages:
      trace.length === 0
        ? messages
        : messages.map((message) =>
            message.id === userId ? { ...message, activity: trace } : message,
          ),
    ...TURN_IDLE,
    trace: [],
  };
}

export function initialState(settings: AiSettings | null): ChatState {
  return {
    phase: "idle",
    messages: [],
    summary: null,
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
