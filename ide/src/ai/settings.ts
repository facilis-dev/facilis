// Persisted AI provider settings (D-045).
//
// Stored in localStorage like the git identity and the recent-projects registry:
// per origin, not per project (SPEC §10.5), and it must be known before the first
// message. The key never leaves this browser except as the provider's own auth
// header; nothing here is encrypted, because a key the panel must re-read at every
// boot can only be obfuscated at rest by keeping its own decryption secret beside
// it — that is not a threat model, it is a fig leaf (PATs get real encryption
// when they are stored encrypted-until-used in OPFS, D-045).

import { deployment } from "@/deploy/current";
import type { ResolvedDeployment } from "@/deploy/types";
import { isConfigured as presetIsConfigured, providerById } from "./providers";
import type { AiSettings } from "./types";

export const AI_SETTINGS_KEY = "vv-ai-settings";

/** The slice of Storage the session needs; tests pass a plain fake. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): SettingsStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Storage disabled (privacy mode / sandboxed frame): settings last one page.
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Dev-only seed (AI-PROBE): a key in the gitignored `ide/.env` configures the
 * DeepSeek preset, so a local session can talk to the model without typing the key.
 * Vite inlines VITE_* variables into the dev bundle only; the mode gate keeps a
 * production build from ever carrying them.
 */
function seedFromEnv(): AiSettings | null {
  // "development" is the Vite dev-server mode: vitest runs in "test", and a
  // production build in "production", so neither can ever pick the key up.
  if (import.meta.env.MODE !== "development") return null;
  const apiKey = text(import.meta.env.VITE_DEEPSEEK_API_KEY);
  if (apiKey === "") return null;
  return {
    providerId: "deepseek",
    apiKey,
    model: text(import.meta.env.VITE_DEEPSEEK_MODEL) || "deepseek-chat",
    baseUrl: text(import.meta.env.VITE_DEEPSEEK_BASE_URL),
  };
}

/**
 * The saved settings, or null when nothing usable was stored. Never throws.
 *
 * A managed build owns the provider set and the endpoint (D-063): a stored
 * provider outside the allowlist is kept but resolves as unconfigured, so the
 * user still sees their saved settings and can pick an allowed provider instead
 * of losing the rest of them silently, while a stored custom base URL is dropped
 * because a managed build can never honour it.
 */
export function loadAiSettings(
  storage: SettingsStorage | null = defaultStorage(),
  d: ResolvedDeployment = deployment,
): AiSettings | null {
  const seed = seedFromEnv();
  if (!storage) return seed;
  try {
    const raw = storage.getItem(AI_SETTINGS_KEY);
    if (!raw) return seed;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return seed;
    const record = parsed as Record<string, unknown>;
    const providerId = text(record.providerId);
    if (!providerId) return seed;
    // The seed wins over saved settings while it is present: the hook exists for
    // local probing, and unsetting the env key restores whatever the dialog saved.
    if (seed !== null) return seed;
    return {
      providerId,
      apiKey: text(record.apiKey),
      model: text(record.model),
      baseUrl: d.profile === "managed" ? "" : text(record.baseUrl),
    };
  } catch {
    return seed;
  }
}

export function saveAiSettings(
  settings: AiSettings,
  storage: SettingsStorage | null = defaultStorage(),
  d: ResolvedDeployment = deployment,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      AI_SETTINGS_KEY,
      JSON.stringify({
        providerId: settings.providerId.trim(),
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
        // Never persist an override a managed build will refuse to use.
        baseUrl: d.profile === "managed" ? "" : settings.baseUrl.trim(),
      }),
    );
  } catch {
    // Storage full or disabled — the settings still work for this page.
  }
}

export function clearAiSettings(storage: SettingsStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(AI_SETTINGS_KEY);
  } catch {
    // Nothing to do: the caller also drops the in-memory settings.
  }
}

/** True when the provider, model, endpoint and (when the provider needs it) key are set. */
export function isConfigured(
  settings: AiSettings | null,
  dev = import.meta.env.DEV,
  d: ResolvedDeployment = deployment,
): boolean {
  if (!settings) return false;
  return presetIsConfigured(settings, providerById(settings.providerId, dev, d), d);
}
