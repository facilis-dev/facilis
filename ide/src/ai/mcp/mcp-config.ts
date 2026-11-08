// MCP server configuration: shape, validation, per-project persistence and the dev seed
// (docs/PTC.md §8, D-118). Kept out of mcp-session.ts so both stay well under the line limit.

import type { McpServerConfig } from "./mcp-client";

export const MCP_SETTINGS_KEY = "vv-ai-mcp";
export const MAX_SERVERS = 8;
const MAX_LABEL_CHARS = 60;
const MAX_TOKEN_CHARS = 400;
const MAX_URL_CHARS = 500;

/** The slice of Storage the session needs; tests pass a plain fake. */
export interface McpStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultStorage(): McpStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "server"
  );
}

function text(value: unknown, maxChars: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxChars) : "";
}

/** `http(s)` only: an MCP URL is a remote endpoint the page fetches itself. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Validate what the UI persisted; unknown or unsafe entries are dropped, never guessed. */
export function sanitizeConfigs(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return [];
  const configs: McpServerConfig[] = [];
  const ids = new Set<string>();
  for (const entry of value.slice(0, MAX_SERVERS)) {
    if (!isRecord(entry)) continue;
    const name = text(entry.name, MAX_LABEL_CHARS);
    const url = text(entry.url, MAX_URL_CHARS);
    if (name.length === 0 || !isHttpUrl(url)) continue;
    let id = slug(name);
    let suffix = 2;
    while (ids.has(id)) {
      id = slug(name) + "_" + suffix;
      suffix += 1;
    }
    ids.add(id);
    const token = text(entry.token, MAX_TOKEN_CHARS);
    configs.push({
      id,
      name,
      url,
      ...(token.length > 0 ? { token } : {}),
      enabled: entry.enabled === true,
    });
  }
  return configs;
}

/** Dev-only seed (AI-PROBE): `VITE_MCP_SERVERS` JSON in the gitignored `ide/.env`. */
export function seedFromEnv(): McpServerConfig[] | null {
  if (import.meta.env.MODE !== "development") return null;
  const raw = (import.meta.env.VITE_MCP_SERVERS as string | undefined) ?? "";
  if (raw.trim().length === 0) return null;
  try {
    const configs = sanitizeConfigs(JSON.parse(raw)).map((config) => ({
      ...config,
      enabled: true,
    }));
    return configs.length > 0 ? configs : null;
  } catch {
    return null;
  }
}

/** The current project's servers; the seed (dev only) wins over what the UI stored. */
export function loadConfigs(
  storage: McpStorage | null,
  root: string | null,
  seed: McpServerConfig[] | null,
): McpServerConfig[] {
  if (seed !== null) return seed;
  if (storage === null || root === null) return [];
  try {
    const raw = storage.getItem(MCP_SETTINGS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? sanitizeConfigs(parsed[root]) : [];
  } catch {
    return [];
  }
}

/** Store the current project's servers, keeping other projects' entries untouched. */
export function saveConfigs(
  storage: McpStorage | null,
  root: string | null,
  configs: readonly McpServerConfig[],
): void {
  if (storage === null || root === null) return;
  try {
    const raw = storage.getItem(MCP_SETTINGS_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    const all = isRecord(parsed) ? { ...parsed } : {};
    all[root] = configs;
    storage.setItem(MCP_SETTINGS_KEY, JSON.stringify(all));
  } catch {
    // Storage full or disabled: the servers still work for this page.
  }
}
