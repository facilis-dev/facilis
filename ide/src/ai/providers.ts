// Provider presets and the two wire protocols the IDE speaks (D-045/D-046).
//
// This module is pure: it builds a request description and reads one stream
// event; client.ts owns fetch and the failure taxonomy. Presets differ only in
// defaults, so adding a provider is data, not a branch in the client.

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
  },
  {
    id: "openai",
    labelKey: "chat.provider.openai",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5",
    keyHintKey: "chat.keyHint.openai",
    requiresKey: true,
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

export function availableProviders(
  dev: boolean = import.meta.env.DEV,
): readonly AiProviderPreset[] {
  return dev ? [...PRESETS, MOCK_PRESET] : PRESETS;
}

export function providerById(
  id: string,
  dev: boolean = import.meta.env.DEV,
): AiProviderPreset | undefined {
  return availableProviders(dev).find((preset) => preset.id === id);
}

export function presetFor(
  settings: AiSettings,
  dev: boolean = import.meta.env.DEV,
): AiProviderPreset | undefined {
  return providerById(settings.providerId, dev);
}

/** The user's override wins; trailing slashes would double the endpoint's. */
export function resolveBaseUrl(settings: AiSettings, preset: AiProviderPreset): string {
  const base = settings.baseUrl.trim() || preset.baseUrl.trim();
  return base.replace(/\/+$/, "");
}

export function isConfigured(settings: AiSettings, preset: AiProviderPreset | undefined): boolean {
  if (!preset) return false;
  if (settings.model.trim() === "") return false;
  if (preset.requiresKey && settings.apiKey.trim() === "") return false;
  // The dev mock is the one protocol that never needs an endpoint.
  if (preset.id === "mock") return true;
  return resolveBaseUrl(settings, preset) !== "";
}

export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ProviderEvent {
  text?: string;
  done?: boolean;
  error?: string;
}

const ANTHROPIC_VERSION = "2023-06-01";

function toWireMessages(
  messages: readonly AiChatTurn[],
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages.map((turn) => ({ role: turn.role, content: turn.content }));
}

export function buildRequest(
  preset: AiProviderPreset,
  settings: AiSettings,
  system: string,
  messages: readonly AiChatTurn[],
): ProviderRequest {
  const base = resolveBaseUrl(settings, preset);
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
        messages: toWireMessages(messages),
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
        ...toWireMessages(messages),
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
  if (isRecord(delta) && typeof delta.content === "string" && delta.content.length > 0) {
    event.text = delta.content;
  }
  if (choice.finish_reason !== null && choice.finish_reason !== undefined) event.done = true;
  return event;
}

function anthropicEvent(value: unknown): ProviderEvent {
  if (!isRecord(value)) return {};
  switch (value.type) {
    case "content_block_delta": {
      const delta = value.delta;
      if (!isRecord(delta) || delta.type !== "text_delta" || typeof delta.text !== "string") {
        return {};
      }
      return { text: delta.text };
    }
    case "message_stop":
      return { done: true };
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
