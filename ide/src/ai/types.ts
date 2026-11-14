// Shared shapes for the IDE's AI chat (D-045, D-046).
//
// Deliberately free of React and of the controller: the pure modules (providers,
// client, prompt, response, diff) and ChatSession are unit-tested against these
// shapes, and the UI only reads them. The model's contract is SPEC §9.2: one
// AIResponse JSON object per turn, patches project-relative.

import type { FilePatch, ValidationResult } from "@facilis.dev/ai";
import type { MessageKey } from "@/i18n";
import type { PtcFailureKind, PtcTraceEntry } from "./ptc/protocol";
import type { ChatGitGateState, ChatTurnWrite } from "./write-types";

export type {
  ChatGitChange,
  ChatGitGateFailure,
  ChatGitGateState,
  ChatTurnWrite,
  GitGate,
  GitSafety,
} from "./write-types";

/** A wire protocol, not a provider: presets differ only in defaults. */
export type AiProtocol = "openai" | "anthropic";

export interface AiProviderPreset {
  id: string;
  /** Localised name in the settings dialog. */
  labelKey: MessageKey;
  protocol: AiProtocol;
  /** Base URL without a trailing slash; the protocol's endpoint path is appended. */
  baseUrl: string;
  /** Filled in when the user picks the provider; still free text. */
  defaultModel: string;
  /** One line telling the user where to create a key. */
  keyHintKey: MessageKey;
  /** Local providers (and the dev mock) need no key. */
  requiresKey: boolean;
  /**
   * The preset's models accept images (D-112). Decided per preset, not per model: an override
   * with a text-only model falls back to the provider's own behaviour (DeepSeek V4-Pro swaps in
   * a placeholder; some OpenAI-compatible endpoints reject the request).
   */
  vision?: boolean;
}

/** What the user configured. Persisted per origin, never sent anywhere but the provider. */
export interface AiSettings {
  providerId: string;
  apiKey: string;
  model: string;
  /** Overrides the preset base URL (Custom provider, local endpoint). */
  baseUrl: string;
}

export interface AiChatTurn {
  role: "user" | "assistant";
  content: string;
  /** Data URLs attached to this turn; only a vision preset serializes them (D-112). */
  images?: readonly string[];
}

/** SPEC §9.2 + D-101: one object per turn, either an exploration program or a patch set. */
export interface AiResponse {
  message: string;
  patches: FilePatch[];
  /** A PTC program to run before answering (SPEC §9.5); absent on a final answer. */
  script?: string;
  /** Another part of the same patch set follows (the answer hit the output limit, D-106). */
  continue?: boolean;
  notes: string[];
  requiresConfirmation: boolean;
}

/** One rendered line of a diff; `kind` decides the prefix and the role colour. */
export interface DiffLine {
  kind: "add" | "del" | "ctx" | "hunk";
  text: string;
}

export interface FileDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** The diff was cut at the per-file cap. */
  truncated: boolean;
}

/** One file of a reviewable proposal. */
export interface ProposedFile {
  patch: FilePatch;
  /** Content before the patch (null when the file did not exist): the diff base and undo image. */
  before: string | null;
  added: number;
  removed: number;
  diff: DiffLine[];
  /** The user may uncheck a file; only accepted files are applied. */
  accepted: boolean;
}

/** A client file that should not run in the browser as written (D-047). */
export interface PatchWarning {
  path: string;
  rule: import("./patch-warnings").PatchWarningRule;
  /** The offending global, module specifier, class or page, interpolated by the UI. */
  symbol: string;
}

export interface ChatProposal {
  files: ProposedFile[];
  notes: string[];
  /** The turn was flagged as destructive (SPEC §9.3 rule 15). */
  requiresConfirmation: boolean;
  /** Review-time warnings; the patches still apply if the user accepts them. */
  warnings: PatchWarning[];
  /** The SPEC §9.3 result (errors blocked the proposal; warnings are informational). */
  validation?: ValidationResult;
}

/** What writing a proposal (or undoing it) did. */
export interface ChatApplied {
  kind: "apply" | "undo";
  ok: boolean;
  written: string[];
  deleted: string[];
  /** "path: reason" per failed file. */
  errors: string[];
  /** Framework revision after a clean write, when the manifest was reachable. */
  revision: string | null;
}

/** The before-images of a clean Apply, so it can be undone without git. */
export interface ChatUndo {
  entries: { path: string; content: string | null }[];
}

export type ChatFailureKind =
  | "aborted"
  | "network"
  | "http"
  | "stream"
  | "empty"
  | "unsupported"
  /** The validator's own parser/analyzer was unavailable: not the model's mistake. */
  | "validator";

/** A provider failure. The message is technical and shown as detail, never translated. */
export interface ChatFailure {
  kind: ChatFailureKind;
  message: string;
  /** HTTP status for kind "http", so the UI can say "refused: 401". */
  status?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: number;
  /** Images the user attached (data URLs, D-113); replayed with the conversation. */
  images?: readonly string[];
  /**
   * The turn activity that FOLLOWED this message: its model calls and PTC programs, settled
   * when the turn ends (success, failure or abort). Set on the user message that opened the
   * turn, so the transcript can render the answer after the work that produced it.
   */
  activity?: readonly ChatActivity[];
  /** Parser/validator output for an unusable answer, shown under the bubble. */
  detail?: string;
}

/** A message typed while a turn was running; the session sends it FIFO on the next idle. */
export interface ChatQueuedMessage {
  id: string;
  /** The trimmed text; empty only for an image-only message. */
  text: string;
  images: readonly string[];
  at: number;
}

/** One model call in the chat's activity timeline (D-110): what it cost and what followed. */
export interface ChatTraceCall {
  kind: "call";
  /** 1-based model call within the turn. */
  n: number;
  elapsedMs: number;
  /** Characters of answer the model produced (0 for a failed call). */
  chars: number;
  /** Characters of reasoning the provider streamed (0 when it exposes none). */
  reasoningChars: number;
  /** What the turn loop did with the answer; "running" while the call streams. */
  outcome: "running" | "script" | "part" | "answer" | "rejected" | "cut" | "failed";
  /** The provider cut the answer at its output limit. */
  truncated: boolean;
  /** The visible reasoning, capped for the transcript (absent when none arrived). */
  reasoning?: string;
}

/** One PTC exploration program as the chat transcript records it (D-101). */
export interface ChatTraceRun {
  kind: "run";
  program: string;
  ok: boolean;
  error?: { kind: PtcFailureKind; message: string };
  toolCalls: number;
  elapsedMs: number;
  entries: PtcTraceEntry[];
  /** App screenshots captured by the program (data URLs, D-112). */
  images?: readonly string[];
}

/** The turn's activity, in order: a model call, then the program it asked for, then the next. */
export type ChatActivity = ChatTraceCall | ChatTraceRun;

export type ChatPhase = "idle" | "sending" | "applying" | "compacting";

/** The model's replayable summary of a covered transcript prefix (O-018 context compaction). */
export interface ChatSummary {
  content: string;
  /** When the summarization call finished. */
  at: number;
  /** Transcript messages the summary replaces: a prefix of ChatState.messages. */
  through: number;
}

/** What the conversation was assembled from, for the footer. */
export interface ChatContextInfo {
  manifestRevision: string | null;
  files: number;
  activeFile: string | null;
  /** AGENTS.md was included in this turn's system prompt (D-048). */
  instructions: boolean;
}

export interface ChatState {
  phase: ChatPhase;
  messages: ChatMessage[];
  /** Messages typed mid-turn: a per-conversation FIFO sent as soon as the session is idle. */
  queued: ChatQueuedMessage[];
  /** The latest compaction, replayed instead of the messages it covers (O-018). */
  summary: ChatSummary | null;
  proposal: ChatProposal | null;
  applied: ChatApplied | null;
  /** Set after a clean Apply; Undo writes these before-images back. */
  undo: ChatUndo | null;
  /** The provider is streaming the answer's `message` field into the last bubble. */
  streaming: boolean;
  /**
   * The rejected answer is being re-asked with the validator findings (SPEC §9.4).
   * `attempt` is 1-based; null while no repair is running (D-108: no attempt cap).
   */
  repair: { attempt: number } | null;
  /**
   * The model calls and PTC programs of the LIVE turn, in order (D-101/D-110). A finished
   * turn's activity moves onto its ChatMessage.activity.
   */
  trace: ChatActivity[];
  /** Live reasoning of the current model call, or null when none is streaming (D-110). */
  reasoning: string | null;
  /** The 1-based exploration program currently running, or null. */
  exploring: number | null;
  /** A patch set arriving in parts (D-106): the 1-based part requested, or null. */
  patchParts: { part: number } | null;
  error: ChatFailure | null;
  /** The clean-tree gate is waiting for the user's choice (the turn is paused). */
  gitGate: ChatGitGateState | null;
  /** Source files the AI wrote in the live turn (or the last finished one). */
  writes: readonly ChatTurnWrite[];
  /** null until a provider was saved. */
  settings: AiSettings | null;
  /** A provider, a model and (when required) a key are present. */
  configured: boolean;
  context: ChatContextInfo | null;
}
