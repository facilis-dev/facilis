import { resolve as resolvePath } from "node:path";

import { isLogLevel, type LogLevel } from "@facilis.dev/core";

import { isProductionEnvironment } from "../env.ts";

/**
 * Log destination resolution (D-119, SPEC §8.7).
 *
 * Where entries go is a deployment concern, so it comes from the environment and never from
 * `facilis.config.ts`: a generated project must not be able to redirect an operator's audit
 * trail. Every invalid value falls back to its documented default and yields a warning, so a
 * typo degrades the sink instead of breaking the boot.
 */

export const LOG_SINK_MODES = ["auto", "stdout", "file", "both"] as const;
export type LogSinkMode = (typeof LOG_SINK_MODES)[number];

export const LOG_SINK_ENV = "FACILIS_LOG_SINK";
export const LOG_DIR_ENV = "FACILIS_LOG_DIR";
export const LOG_MAX_BYTES_ENV = "FACILIS_LOG_MAX_BYTES";
export const LOG_KEEP_ENV = "FACILIS_LOG_KEEP";
export const LOG_LEVEL_ENV = "FACILIS_LOG_LEVEL";

/** 10 MiB keeps a dev log bounded while the IDE editor can still read it comfortably. */
export const DEFAULT_LOG_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_LOG_KEEP = 5;
export const DEFAULT_LOG_DIR_SEGMENTS = [".facilis", "logs"] as const;
const MAX_LOG_MAX_BYTES = 1024 * 1024 * 1024;
const MAX_LOG_KEEP = 1000;

export interface LogSinkSelection {
  readonly stdout: boolean;
  readonly file: boolean;
}

export interface ResolvedLogSettings {
  /** The configured mode, kept for diagnostics (`auto` stays `auto`). */
  readonly mode: LogSinkMode;
  readonly sinks: LogSinkSelection;
  /** Absolute directory of the JSONL files (only used when `sinks.file` is true). */
  readonly dir: string;
  readonly maxBytes: number;
  readonly keep: number;
  /** Environment override for `logging.level`; null keeps the project config. */
  readonly level: LogLevel | null;
}

/** Shaped like `ManifestWarning` so the bootstrap can forward it unchanged. */
export interface LogSettingsWarning {
  readonly code: string;
  readonly message: string;
}

export interface ResolvedLogSettingsResult {
  readonly settings: ResolvedLogSettings;
  readonly warnings: readonly LogSettingsWarning[];
}

export interface ResolveLogSettingsInput {
  readonly env: NodeJS.ProcessEnv;
  readonly projectRoot: string;
  /** Test seam: override the NODE_ENV-derived production detection. */
  readonly production?: boolean;
}

export function resolveLogSettings(input: ResolveLogSettingsInput): ResolvedLogSettingsResult {
  const warnings: LogSettingsWarning[] = [];
  const production = input.production ?? isProductionEnvironment(input.env);
  const mode = parseSinkMode(readEnv(input.env, LOG_SINK_ENV), warnings);
  const dirValue = readEnv(input.env, LOG_DIR_ENV);
  const dir =
    dirValue === undefined
      ? resolvePath(input.projectRoot, ...DEFAULT_LOG_DIR_SEGMENTS)
      : resolvePath(input.projectRoot, dirValue);
  const maxBytes = parseBoundedInteger(
    input.env,
    LOG_MAX_BYTES_ENV,
    DEFAULT_LOG_MAX_BYTES,
    1,
    MAX_LOG_MAX_BYTES,
    warnings,
  );
  const keep = parseBoundedInteger(
    input.env,
    LOG_KEEP_ENV,
    DEFAULT_LOG_KEEP,
    0,
    MAX_LOG_KEEP,
    warnings,
  );
  const level = parseLevel(input.env, warnings);
  return {
    settings: { mode, sinks: sinkSelection(mode, production), dir, maxBytes, keep, level },
    warnings,
  };
}

export function isLogSinkMode(value: string): value is LogSinkMode {
  return (LOG_SINK_MODES as readonly string[]).includes(value);
}

function sinkSelection(mode: LogSinkMode, production: boolean): LogSinkSelection {
  switch (mode) {
    case "stdout":
      return { stdout: true, file: false };
    case "file":
      return { stdout: false, file: true };
    case "both":
      return { stdout: true, file: true };
    case "auto":
      // Dev is where the IDE workflow lives: files need no setup. Production defaults to
      // stdout because a deploy without writable disk still has a log platform.
      return production ? { stdout: true, file: false } : { stdout: false, file: true };
  }
}

function parseSinkMode(raw: string | undefined, warnings: LogSettingsWarning[]): LogSinkMode {
  if (raw === undefined) return "auto";
  if (!isLogSinkMode(raw)) {
    warnings.push(
      warning(`${LOG_SINK_ENV}="${raw}" is not one of ${LOG_SINK_MODES.join("|")}; using "auto".`),
    );
    return "auto";
  }
  return raw;
}

function parseBoundedInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
  warnings: LogSettingsWarning[],
): number {
  const raw = readEnv(env, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    warnings.push(
      warning(`${name}="${raw}" is not an integer in [${min}, ${max}]; using ${fallback}.`),
    );
    return fallback;
  }
  return value;
}

function parseLevel(env: NodeJS.ProcessEnv, warnings: LogSettingsWarning[]): LogLevel | null {
  const raw = readEnv(env, LOG_LEVEL_ENV);
  if (raw === undefined) return null;
  if (!isLogLevel(raw)) {
    warnings.push(warning(`${LOG_LEVEL_ENV}="${raw}" is not a log level; keeping logging.level.`));
    return null;
  }
  return raw;
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function warning(message: string): LogSettingsWarning {
  return { code: "logging_env_invalid", message };
}
