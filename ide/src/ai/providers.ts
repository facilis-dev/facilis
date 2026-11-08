// Provider presets and the two wire protocols the IDE speaks (D-045/D-046).
//
// This module is pure: it builds a request description and reads one stream
// event; client.ts owns fetch and the failure taxonomy. Presets differ only in
// defaults, so adding a provider is data, not a branch in the client.

import { deployment } from "@/deploy/current";
import type { ResolvedDeployment } from "@/deploy/types";
import { toWireMessages } from "./provider-wire";
import type { AiChatTurn, AiProviderPreset, AiProtocol, AiSettings } from "./types";

export const PRESETS: readonly AiProviderPreset[] = [
  {
    id: "anthropic",
    labelKey: "chat.provider.anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-5",
    keyHintKey: "chat.keyHint.anthropic",
    requiresKey: true,
    vision: true,
  },
  {
    id: "openai",
    labelKey: "chat.provider.openai",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5",
    keyHintKey: "chat.keyHint.openai",
    requiresKey: true,
    vision: true,
  },
  {
    id: "openrouter",
    labelKey: "chat.provider.openrouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/auto",
    keyHintKey: "chat.keyHint.openrouter",
    requiresKey: true,
  },
  {
    id: "deepseek",
    labelKey: "chat.provider.deepseek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    keyHintKey: "chat.keyHint.deepseek",
    requiresKey: true,
    // DeepSeek V4.1 Flash (what both `deepseek-chat` and `deepseek-flash` resolve to) reads
    // images; V4-Pro is text-only and replaces them with a placeholder (D-112).
    vision: true,
  },
  {
    id: "custom",
    labelKey: "chat.provider.custom",
    protocol: "openai",
    baseUrl: "",
    defaultModel: "",
    keyHintKey: "chat.keyHint.custom",
    requiresKey: false,
  },
];

/** Dev-only: never calls the network, so it has no endpoint and needs no key. */
export const MOCK_PRESET: AiProviderPreset = {
  id: "mock",
  labelKey: "chat.provider.mock",
  protocol: "openai",
  baseUrl: "",
  defaultModel: "mock",
  keyHintKey: "chat.keyHint.mock",
  requiresKey: false,
};

/** Stable id of the synthetic preset a `gateway` deployment exposes. */
export const GATEWAY_PRESET_ID = "gateway";

/**
 * The single preset a `gateway` deployment exposes. The shape is unchanged - the
 * gateway speaks the OpenAI-compatible wire protocol - so the client needs no
 * branch; only the endpoint differs, and no key is stored in the browser
 * (AI-SKILLS.md 2-3). The label borrows the generic "Provider" string until the
 * UI slice that renders gateway-specific copy owns its own key; the id is the
 * contract every other module keys on.
 */
export function gatewayPreset(d: ResolvedDeployment): AiProviderPreset {
  return {
    id: GATEWAY_PRESET_ID,
    labelKey: "chat.settings.provider",
    protocol: "openai",
    baseUrl: (d.ai.gateway ?? "").replace(/\/+$/, ""),
    defaultModel: "",
    keyHintKey: "chat.keyHint.custom",
    requiresKey: false,
  };
}

/**
 * The presets this build may offer. The deployment decides (D-063): `open` keeps
 * today's list, `managed` exposes only its allowlist or its gateway, and `off`
 * exposes nothing. A managed build never includes `custom` or `mock`, in dev or
 * not, because neither is a deployment decision.
 */
export function availableProviders(
  dev: boolean = import.meta.env.DEV,
  d: ResolvedDeployment = deployment,
): readonly AiProviderPreset[] {
  if (d.ai.mode === "off") return [];
  if (d.ai.mode === "gateway") return [gatewayPreset(d)];
  if (d.profile === "managed") {
    return PRESETS.filter((preset) => preset.id !== "custom" && d.ai.providers.includes(preset.id));
  }
  return dev ? [...PRESETS, MOCK_PRESET] : PRESETS;
}

export function providerById(
  id: string,
  dev: boolean = import.meta.env.DEV,
  d: ResolvedDeployment = deployment,
): AiProviderPreset | undefined {
  return availableProviders(dev, d).find((preset) => preset.id === id);
}

export function presetFor(
  settings: AiSettings,
  dev: boolean = import.meta.env.DEV,
  d: ResolvedDeployment = deployment,
): AiProviderPreset | undefined {
  return providerById(settings.providerId, dev, d);
}

/**
 * The endpoint a request goes to. In a managed build the deployment owns it, so
 * the user's override is ignored (AI-SKILLS.md 2: the custom base URL is an
 * open-profile developer feature). Trailing slashes would double the path's.
 */
export function resolveBaseUrl(
  settings: AiSettings,
  preset: AiProviderPreset,
  d: ResolvedDeployment = deployment,
): string {
  const override = settings.baseUrl.trim();
  const base = d.profile === "managed" ? preset.baseUrl.trim() : override || preset.baseUrl.trim();
  return base.replace(/\/+$/, "");
}

export function isConfigured(
  settings: AiSettings,
  preset: AiProviderPreset | undefined,
  d: ResolvedDeployment = deployment,
): boolean {
  if (!preset) return false;
  if (settings.model.trim() === "") return false;
  if (preset.requiresKey && settings.apiKey.trim() === "") return false;
  // The dev mock is the one protocol that never needs an endpoint.
  if (preset.id === "mock") return true;
  return resolveBaseUrl(settings, preset, d) !== "";
}

export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ProviderEvent {
  text?: string;
  /** Visible reasoning (DeepSeek `reasoning_content`, OpenRouter `reasoning`, Anthropic thinking). */
  reasoning?: string;
  done?: boolean;
  error?: string;
  /** Why the provider ended the answer: "stop", "length" / "max_tokens", "end_turn"… */
  stopReason?: string;
}

const ANTHROPIC_VERSION = "2023-06-01";

export function buildRequest(
  preset: AiProviderPreset,
  settings: AiSettings,
  system: string,
  messages: readonly AiChatTurn[],
  d: ResolvedDeployment = deployment,
): ProviderRequest {
  const base = resolveBaseUrl(settings, preset, d);
  if (preset.protocol === "anthropic") {
    return {
      url: base + "/v1/messages",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: {
        model: settings.model,
        max_tokens: 8192,
        stream: true,
        ...(system.length > 0 ? { system } : {}),
        messages: toWireMessages(messages, preset.protocol, preset.vision === true),
      },
    };
  }
  return {
    url: base + "/chat/completions",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + settings.apiKey,
    },
    body: {
      model: settings.model,
      stream: true,
      messages: [
        ...(system.length > 0 ? [{ role: "system", content: system }] : []),
        ...toWireMessages(messages, preset.protocol, preset.vision === true),
      ],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function messageOf(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return undefined;
}

function openAiEvent(value: unknown): ProviderEvent {
  if (!isRecord(value)) return {};
  const error = messageOf(value.error);
  if (error !== undefined) return { error };
  const choices = value.choices;
  if (!Array.isArray(choices) || choices.length === 0) return {};
  const choice = choices[0];
  if (!isRecord(choice)) return {};
  const event: ProviderEvent = {};
  const delta = choice.delta;
  if (isRecord(delta)) {
    if (typeof delta.content === "string" && delta.content.length > 0) {
      event.text = delta.content;
    }
    // Reasoning models stream their thinking in their own field (DeepSeek uses
    // reasoning_content; the OpenAI-compatible gateways mostly reasoning).
    const reasoning =
      typeof delta.reasoning_content === "string"
        ? delta.reasoning_content
        : typeof delta.reasoning === "string"
          ? delta.reasoning
          : "";
    if (reasoning.length > 0) event.reasoning = reasoning;
  }
  if (typeof choice.finish_reason === "string") {
    event.done = true;
    event.stopReason = choice.finish_reason;
  }
  return event;
}

function anthropicEvent(value: unknown): ProviderEvent {
  if (!isRecord(value)) return {};
  switch (value.type) {
    case "content_block_delta": {
      const delta = value.delta;
      if (!isRecord(delta)) return {};
      // Extended thinking streams as thinking_delta before (and beside) the answer text.
      if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
        return { reasoning: delta.thinking };
      }
      if (delta.type !== "text_delta" || typeof delta.text !== "string") return {};
      return { text: delta.text };
    }
    case "message_stop":
      return { done: true };
    case "message_delta": {
      // Anthropic reports why the message ended here: "end_turn", "max_tokens", …
      const delta = value.delta;
      if (!isRecord(delta) || typeof delta.stop_reason !== "string") return {};
      return { stopReason: delta.stop_reason };
    }
    case "error": {
      const error = messageOf(value.error);
      return error === undefined ? {} : { error };
    }
    default:
      return {};
  }
}

export function parseProviderEvent(protocol: AiProtocol, value: unknown): ProviderEvent {
  return protocol === "anthropic" ? anthropicEvent(value) : openAiEvent(value);
}
