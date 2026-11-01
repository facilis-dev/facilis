import { describe, expect, it } from "vitest";
import { openDeployment, resolveDeployment } from "@/deploy/resolve";
import type { DeploymentInput, ResolvedDeployment } from "@/deploy/types";
import {
  GATEWAY_PRESET_ID,
  MOCK_PRESET,
  PRESETS,
  availableProviders,
  buildRequest,
  isConfigured,
  parseProviderEvent,
  presetFor,
  providerById,
  resolveBaseUrl,
} from "./providers";
import type { AiSettings } from "./types";

function preset(id: string, d: ResolvedDeployment = openDeployment()) {
  const found = providerById(id, true, d);
  if (!found) throw new Error("missing preset " + id);
  return found;
}

const MANAGED: DeploymentInput = {
  profile: "managed",
  company: { name: "Acme", domain: "facilis.acme.example" },
  packages: { registry: "https://npm.acme.example" },
  projects: { preview: { origin: "https://preview.facilis.acme.example" } },
};

function managed(ai: DeploymentInput["ai"] = {}): ResolvedDeployment {
  return resolveDeployment({ ...MANAGED, ai });
}

function openAiSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  return { providerId: "openai", apiKey: "sk-test", model: "gpt-5", baseUrl: "", ...overrides };
}

describe("provider presets", () => {
  it("ships the five wire presets in order", () => {
    expect(PRESETS.map((entry) => entry.id)).toEqual([
      "anthropic",
      "openai",
      "openrouter",
      "deepseek",
      "custom",
    ]);
    expect(PRESETS.map((entry) => entry.protocol)).toEqual([
      "anthropic",
      "openai",
      "openai",
      "openai",
      "openai",
    ]);
    expect(preset("anthropic")).toMatchObject({
      baseUrl: "https://api.anthropic.com",
      defaultModel: "claude-sonnet-4-5",
      requiresKey: true,
    });
    expect(preset("openai")).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5",
    });
    expect(preset("openrouter")).toMatchObject({
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "openrouter/auto",
    });
    expect(preset("deepseek")).toMatchObject({
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
    });
    expect(preset("custom")).toMatchObject({ baseUrl: "", defaultModel: "", requiresKey: false });
  });

  it("describes the dev mock as keyless and endpointless", () => {
    expect(MOCK_PRESET).toMatchObject({
      id: "mock",
      protocol: "openai",
      baseUrl: "",
      defaultModel: "mock",
      requiresKey: false,
      labelKey: "chat.provider.mock",
      keyHintKey: "chat.keyHint.mock",
    });
  });

  it("offers the mock only in dev", () => {
    expect(availableProviders(false).map((entry) => entry.id)).not.toContain("mock");
    expect(availableProviders(true).at(-1)).toBe(MOCK_PRESET);
    expect(providerById("mock", false)).toBeUndefined();
    expect(providerById("mock")).toBe(MOCK_PRESET);
  });

  it("resolves a preset from settings", () => {
    expect(presetFor(openAiSettings())).toBe(preset("openai"));
    expect(presetFor(openAiSettings({ providerId: "nope" }))).toBeUndefined();
  });
});

describe("resolveBaseUrl", () => {
  it("prefers the user override and strips trailing slashes", () => {
    const settings = openAiSettings({ baseUrl: "  http://localhost:11434/v1///  " });
    expect(resolveBaseUrl(settings, preset("openai"))).toBe("http://localhost:11434/v1");
  });

  it("falls back to the preset base URL", () => {
    expect(resolveBaseUrl(openAiSettings(), preset("openai"))).toBe("https://api.openai.com/v1");
    expect(resolveBaseUrl(openAiSettings({ baseUrl: "   " }), preset("custom"))).toBe("");
  });
});

describe("isConfigured", () => {
  it("requires a model and a key only when the preset needs one", () => {
    expect(isConfigured(openAiSettings(), preset("openai"))).toBe(true);
    expect(isConfigured(openAiSettings({ apiKey: "" }), preset("openai"))).toBe(false);
    expect(isConfigured(openAiSettings({ model: "   " }), preset("openai"))).toBe(false);
    expect(
      isConfigured(
        { providerId: "custom", apiKey: "", model: "local", baseUrl: "http://localhost:11434/v1" },
        preset("custom"),
      ),
    ).toBe(true);
  });

  it("requires a resolved base URL", () => {
    expect(
      isConfigured(
        { providerId: "custom", apiKey: "", model: "local", baseUrl: "" },
        preset("custom"),
      ),
    ).toBe(false);
    expect(isConfigured(openAiSettings(), undefined)).toBe(false);
  });

  it("treats the keyless dev mock as configured", () => {
    const settings: AiSettings = { providerId: "mock", apiKey: "", model: "mock", baseUrl: "" };
    expect(isConfigured(settings, MOCK_PRESET)).toBe(true);
    expect(isConfigured({ ...settings, model: "" }, MOCK_PRESET)).toBe(false);
    expect(isConfigured(settings, undefined)).toBe(false);
  });
});

describe("buildRequest", () => {
  const turns = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ] as const;

  it("builds an OpenAI chat completion request", () => {
    const request = buildRequest(preset("openai"), openAiSettings(), "SYSTEM", turns);
    expect(request.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(request.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer sk-test",
    });
    expect(request.body).toEqual({
      model: "gpt-5",
      stream: true,
      messages: [
        { role: "system", content: "SYSTEM" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });
  });

  it("omits the system message when the system prompt is empty", () => {
    const request = buildRequest(preset("openai"), openAiSettings(), "", turns);
    expect(request.body).toMatchObject({ messages: turns });
  });

  it("builds an Anthropic messages request with browser access", () => {
    const settings: AiSettings = {
      providerId: "anthropic",
      apiKey: "sk-ant",
      model: "claude-sonnet-4-5",
      baseUrl: "",
    };
    const request = buildRequest(preset("anthropic"), settings, "SYSTEM", turns);
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.headers).toEqual({
      "content-type": "application/json",
      "x-api-key": "sk-ant",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    });
    expect(request.body).toEqual({
      model: "claude-sonnet-4-5",
      max_tokens: 8192,
      stream: true,
      system: "SYSTEM",
      messages: turns,
    });
  });

  it("uses a custom base URL for local OpenAI-compatible servers", () => {
    const settings = openAiSettings({ providerId: "custom", baseUrl: "http://localhost:11434/v1" });
    expect(buildRequest(preset("custom"), settings, "", turns).url).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
  });
});

describe("parseProviderEvent", () => {
  it("reads OpenAI text, completion and error deltas", () => {
    expect(parseProviderEvent("openai", { choices: [{ delta: { content: "Hi" } }] })).toEqual({
      text: "Hi",
    });
    expect(
      parseProviderEvent("openai", { choices: [{ delta: {}, finish_reason: "stop" }] }),
    ).toEqual({ done: true });
    expect(parseProviderEvent("openai", { choices: [{ delta: {} }] })).toEqual({});
    expect(parseProviderEvent("openai", { error: { message: "overloaded" } })).toEqual({
      error: "overloaded",
    });
    expect(parseProviderEvent("openai", null)).toEqual({});
  });

  it("reads Anthropic text deltas, message_stop and errors", () => {
    expect(
      parseProviderEvent("anthropic", {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Salut" },
      }),
    ).toEqual({ text: "Salut" });
    expect(parseProviderEvent("anthropic", { type: "message_stop" })).toEqual({ done: true });
    expect(parseProviderEvent("anthropic", { type: "error", error: { message: "boom" } })).toEqual({
      error: "boom",
    });
    expect(parseProviderEvent("anthropic", { type: "ping" })).toEqual({});
    expect(parseProviderEvent("anthropic", "nope")).toEqual({});
  });
});

describe("deployment policy", () => {
  const byo = managed({ mode: "byo", providers: ["openai", "deepseek"] });
  const gateway = managed({ mode: "gateway", gateway: "https://llm.acme.example/v1/" });

  it("offers no provider when a managed build disables AI", () => {
    const off = managed();
    expect(availableProviders(true, off)).toEqual([]);
    expect(providerById("openai", true, off)).toBeUndefined();
    expect(presetFor(openAiSettings(), true, off)).toBeUndefined();
  });

  it("offers only the allowlisted managed presets, never custom or mock", () => {
    expect(availableProviders(true, byo).map((entry) => entry.id)).toEqual(["openai", "deepseek"]);
    expect(providerById("anthropic", true, byo)).toBeUndefined();
    expect(providerById("custom", true, byo)).toBeUndefined();
    expect(providerById("mock", true, byo)).toBeUndefined();
  });

  it("represents a managed gateway as one synthetic preset", () => {
    const list = availableProviders(true, gateway);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: GATEWAY_PRESET_ID,
      protocol: "openai",
      baseUrl: "https://llm.acme.example/v1",
      requiresKey: false,
    });
  });

  it("ignores the user's base URL in a managed build", () => {
    const settings = openAiSettings({ baseUrl: "http://localhost:11434/v1" });
    expect(resolveBaseUrl(settings, preset("openai"), byo)).toBe("https://api.openai.com/v1");
    expect(resolveBaseUrl(settings, preset("gateway", gateway), gateway)).toBe(
      "https://llm.acme.example/v1",
    );
    expect(resolveBaseUrl(settings, preset("openai"), openDeployment())).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("builds the request against the deployment's endpoint", () => {
    const settings = openAiSettings({ baseUrl: "http://localhost:11434/v1" });
    const turns = [{ role: "user", content: "hi" }] as const;
    expect(buildRequest(preset("openai"), settings, "", turns, byo).url).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
    expect(buildRequest(preset("gateway", gateway), settings, "", turns, gateway).url).toBe(
      "https://llm.acme.example/v1/chat/completions",
    );
  });
});
