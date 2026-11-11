import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import type { AuditLogEntry, LogEntry } from "@facilis.dev/core";

import { chainAuditEntry, isChainedAuditEntry, type AuditChainHead } from "./audit-chain.ts";
import type { LogSettingsWarning } from "./log-settings.ts";
import type { LogSink, LogStream } from "./log-sink.ts";

/**
 * JSONL file sink with size-based rotation (D-119).
 *
 * Writes are synchronous and serialized by construction (one file writer per process), which
 * is what makes the audit chain's `prevHash` exact. A file is rotated before an append that
 * would pass the cap: the active file becomes `.1`, older files shift by one and the oldest is
 * deleted, keeping exactly `keep` rotated files. Retention beyond that is the deploy's job.
 *
 * `append` throws on any filesystem failure. The runtime turns that into a dropped
 * access/error/app entry (best effort) or a failed request for audit (fail closed, D-099).
 */
export interface FileLogSinkOptions {
  readonly dir: string;
  readonly maxBytes: number;
  readonly keep: number;
}

export interface FileLogSinkSetup {
  readonly sink: LogSink;
  readonly warnings: readonly LogSettingsWarning[];
}

const LOG_FILE_EXTENSION = ".jsonl";

export function logFilePath(dir: string, stream: LogStream, index?: number): string {
  const suffix = index === undefined ? LOG_FILE_EXTENSION : `.${index}${LOG_FILE_EXTENSION}`;
  return join(dir, `${stream}${suffix}`);
}

export function createFileLogSink(options: FileLogSinkOptions): FileLogSinkSetup {
  const warnings: LogSettingsWarning[] = [];
  let directoryReady = tryCreateDirectory(options.dir, warnings);
  let auditHead: AuditChainHead | null = directoryReady
    ? readAuditHead(options.dir, warnings)
    : null;

  const append = (stream: LogStream, entry: LogEntry): void => {
    if (!directoryReady) directoryReady = createDirectory(options.dir);
    const path = logFilePath(options.dir, stream);
    const chained = stream === "audit" ? chainAuditEntry(entry as AuditLogEntry, auditHead) : null;
    const line = `${JSON.stringify(chained ?? entry)}\n`;
    rotateIfNeeded(path, Buffer.byteLength(line, "utf8"), options);
    appendFileSync(path, line, "utf8");
    // The chain only advances after the bytes are on disk, so a failed append cannot leave a
    // gap the next entry would silently hash over.
    if (chained !== null) auditHead = { seq: chained.seq, hash: chained.hash };
  };

  return { sink: { append }, warnings };
}

function readAuditHead(dir: string, warnings: LogSettingsWarning[]): AuditChainHead | null {
  const path = logFilePath(dir, "audit");
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    warnings.push({
      code: "logging_audit_chain_unreadable",
      message: `Could not read the audit chain ${path}: ${describe(error)}. Starting a new chain.`,
    });
    return null;
  }
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  const last = lines[lines.length - 1];
  if (last === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(last);
    if (!isChainedAuditEntry(parsed)) throw new Error("the last line is not a chained audit entry");
    return { seq: parsed.seq, hash: parsed.hash };
  } catch (error) {
    // A corrupt/truncated tail must not make the audit stream unwritable (the app would keep
    // booting) nor pretend the chain is intact: warn and restart, the tamper is visible.
    warnings.push({
      code: "logging_audit_chain_reset",
      message: `The audit chain in ${path} could not be continued (${describe(error)}); starting a new chain.`,
    });
    return null;
  }
}

function rotateIfNeeded(path: string, incomingBytes: number, options: FileLogSinkOptions): void {
  const size = fileSize(path);
  // `size > 0` keeps a single over-cap entry writable instead of rotating an empty file
  // forever: a line larger than the cap is written once and rotated by the next append.
  if (size === 0 || size + incomingBytes <= options.maxBytes) return;
  rotate(path, options.keep);
}

function rotate(path: string, keep: number): void {
  if (keep <= 0) {
    rmSync(path, { force: true });
    return;
  }
  rmSync(rotatedPath(path, keep), { force: true });
  for (let index = keep - 1; index >= 1; index -= 1) {
    renameIfExists(rotatedPath(path, index), rotatedPath(path, index + 1));
  }
  renameSync(path, rotatedPath(path, 1));
}

function rotatedPath(path: string, index: number): string {
  return `${path.slice(0, -LOG_FILE_EXTENSION.length)}.${index}${LOG_FILE_EXTENSION}`;
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch (error) {
    if (isMissingFile(error)) return 0;
    throw error;
  }
}

function renameIfExists(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
}

function createDirectory(dir: string): boolean {
  mkdirSync(dir, { recursive: true });
  return true;
}

function tryCreateDirectory(dir: string, warnings: LogSettingsWarning[]): boolean {
  try {
    return createDirectory(dir);
  } catch (error) {
    warnings.push({
      code: "logging_dir_unwritable",
      message: `Could not create the log directory ${dir}: ${describe(error)}. Access/error/app entries will be dropped; audit writes will fail closed.`,
    });
    return false;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
