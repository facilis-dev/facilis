// Shared shapes for the IDE's AI chat (D-045, D-046).
//
// Deliberately free of React and of the controller: the pure modules (providers,
// client, prompt, response, diff) and ChatSession are unit-tested against these
// shapes, and the UI only reads them. The model's contract is SPEC §9.2: one
// AIResponse JSON object per turn, patches project-relative.

import type { FilePatch } from "@facilis/ai";
import type { MessageKey } from "@/i18n";

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

/** SPEC §9.2: the only thing the model may return. */
export interface AiResponse {
  message: string;
  patches: FilePatch[];
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
  added: number;
  removed: number;
  diff: DiffLine[];
  /** The user may uncheck a file; only accepted files are applied. */
  accepted: boolean;
}

export interface ChatProposal {
  files: ProposedFile[];
  notes: string[];
  /** The turn was flagged as destructive (SPEC §9.3 rule 15). */
  requiresConfirmation: boolean;
}

export interface ChatApplied {
  ok: boolean;
  written: string[];
  deleted: string[];
  /** "path: reason" per failed file. */
  errors: string[];
  /** Framework revision after a clean write, when the manifest was reachable. */
  revision: string | null;
}

export type ChatFailureKind =
  | "aborted"
  | "network"
  | "http"
  | "stream"
  | "empty"
  | "unsupported"
  /** The answer arrived but was not a usable AIResponse (parse/validation). */
  | "parse";

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

export type ChatPhase = "idle" | "sending" | "applying";

/** What the conversation was assembled from, for the footer. */
export interface ChatContextInfo {
  manifestRevision: string | null;
  files: number;
  activeFile: string | null;
}

export interface ChatState {
  phase: ChatPhase;
  messages: ChatMessage[];
  proposal: ChatProposal | null;
  applied: ChatApplied | null;
  error: ChatFailure | null;
  /** null until a provider was saved. */
  settings: AiSettings | null;
  /** A provider, a model and (when required) a key are present. */
  configured: boolean;
  context: ChatContextInfo | null;
}
