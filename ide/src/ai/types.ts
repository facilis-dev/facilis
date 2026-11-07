// Shared shapes for the IDE's AI chat (D-045, D-046).
//
// Deliberately free of React and of the controller: the pure modules (providers,
// client, prompt, response, diff) and ChatSession are unit-tested against these
// shapes, and the UI only reads them. The model's contract is SPEC §9.2: one
// AIResponse JSON object per turn, patches project-relative.

import type { FilePatch, ValidationResult } from "@facilis/ai";
import type { MessageKey } from "@/i18n";
import type { PtcFailureKind, PtcTraceEntry } from "./ptc/protocol";

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
  rule: "node-global" | "server-import";
  /** The offending global or module specifier, interpolated by the UI. */
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
  /** The answer arrived but was not a usable AIResponse (parse/validation). */
  | "parse"
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
  /** Parser/validator output for an unusable answer, shown under the bubble. */
  detail?: string;
}

/** One PTC exploration program as the chat transcript records it (D-101). */
export interface ChatTraceRun {
  program: string;
  ok: boolean;
  error?: { kind: PtcFailureKind; message: string };
  toolCalls: number;
  elapsedMs: number;
  entries: PtcTraceEntry[];
}

export type ChatPhase = "idle" | "sending" | "applying";

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
  proposal: ChatProposal | null;
  applied: ChatApplied | null;
  /** Set after a clean Apply; Undo writes these before-images back. */
  undo: ChatUndo | null;
  /** The provider is streaming the answer's `message` field into the last bubble. */
  streaming: boolean;
  /**
   * The rejected answer is being re-asked with the validator findings (SPEC §9.4).
   * `attempt` is 1-based; null while no repair is running.
   */
  repair: { attempt: number; max: number } | null;
  /** The PTC exploration of the current turn (D-101); empty when the runtime is off. */
  trace: ChatTraceRun[];
  /** The 1-based exploration program currently running, or null. */
  exploring: number | null;
  /** A patch set arriving in parts (D-106): the 1-based part requested, or null. */
  patchParts: { part: number; max: number } | null;
  error: ChatFailure | null;
  /** null until a provider was saved. */
  settings: AiSettings | null;
  /** A provider, a model and (when required) a key are present. */
  configured: boolean;
  context: ChatContextInfo | null;
}
