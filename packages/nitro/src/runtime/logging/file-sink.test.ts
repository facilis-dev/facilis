import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AccessLogEntry, AuditLogEntry } from "@facilis.dev/core";

import { verifyAuditChain } from "./audit-chain.ts";
import { createFileLogSink, logFilePath } from "./file-sink.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "facilis-logs-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function accessEntry(index: number): AccessLogEntry {
  return {
    kind: "access",
    ts: "2026-11-08T12:00:00.000Z",
    level: "info",
    requestId: `request-${index}0000000`,
    method: "GET",
    path: "/api/items",
    status: 200,
    durationMs: 3,
  };
}

function auditEntry(index: number): AuditLogEntry {
  return {
    kind: "audit",
    ts: "2026-11-08T12:00:00.000Z",
    level: "info",
    requestId: `request-${index}0000000`,
    event: "sudo:started",
    actor: "user:user-1",
    userId: "user-1",
    operation: "items:write",
    reason: "requires the system role",
    tables: ["items"],
  };
}

function readJsonLines(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function setup(maxBytes = 1024 * 1024, keep = 5) {
  return createFileLogSink({ dir, maxBytes, keep });
}

describe("file log sink", () => {
  it("writes one JSONL entry to its stream file", () => {
    const { sink, warnings } = setup();
    sink.append("access", accessEntry(0));

    expect(warnings).toEqual([]);
    const entries = readJsonLines(logFilePath(dir, "access"));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.["kind"]).toBe("access");
    expect(entries[0]?.["path"]).toBe("/api/items");
    expect(existsSync(logFilePath(dir, "audit"))).toBe(false);
  });

  it("chain-writes audit entries and verifies them on readback", () => {
    const { sink } = setup();
    for (let index = 0; index < 3; index += 1) sink.append("audit", auditEntry(index));

    const entries = readJsonLines(logFilePath(dir, "audit"));
    expect(entries.map((entry) => entry["seq"])).toEqual([1, 2, 3]);
    expect(entries[1]?.["prevHash"]).toBe(entries[0]?.["hash"]);
    expect(verifyAuditChain(entries)).toEqual({ ok: true, entries: 3 });
  });

  it("continues the audit chain across a restart", () => {
    const first = setup();
    first.sink.append("audit", auditEntry(0));
    first.sink.append("audit", auditEntry(1));

    const second = setup();
    second.sink.append("audit", auditEntry(2));

    const entries = readJsonLines(logFilePath(dir, "audit"));
    expect(entries.map((entry) => entry["seq"])).toEqual([1, 2, 3]);
    expect(verifyAuditChain(entries)).toEqual({ ok: true, entries: 3 });
  });

  it("rotates at the byte cap and keeps the requested files", () => {
    const { sink } = setup(1, 2);
    for (let index = 0; index < 4; index += 1) sink.append("audit", auditEntry(index));

    expect(readdirSync(dir).sort()).toEqual(["audit.1.jsonl", "audit.2.jsonl", "audit.jsonl"]);

    const active = readJsonLines(logFilePath(dir, "audit"));
    const first = readJsonLines(logFilePath(dir, "audit", 1));
    const second = readJsonLines(logFilePath(dir, "audit", 2));

    expect(active[0]?.["seq"]).toBe(4);
    expect(first[0]?.["seq"]).toBe(3);
    expect(second[0]?.["seq"]).toBe(2);
    // The chain links survive rotation: the active file starts at the last rotated entry.
    expect(verifyAuditChain(active).ok).toBe(true);
    expect(verifyAuditChain(first).ok).toBe(true);
    expect(verifyAuditChain(second).ok).toBe(true);
    expect(active[0]?.["prevHash"]).toBe(first[0]?.["hash"]);
    expect(first[0]?.["prevHash"]).toBe(second[0]?.["hash"]);
  });

  it("drops rotated files when keep is zero", () => {
    const { sink } = setup(1, 0);
    sink.append("access", accessEntry(0));
    sink.append("access", accessEntry(1));

    expect(readdirSync(dir).sort()).toEqual(["access.jsonl"]);
    expect(readJsonLines(logFilePath(dir, "access"))).toHaveLength(1);
  });

  it("warns when the log directory cannot be created and fails the write", () => {
    const brokenDir = join(dir, "not-a-directory");
    writeFileSync(brokenDir, "");
    const { sink, warnings } = createFileLogSink({ dir: brokenDir, maxBytes: 1024, keep: 1 });

    expect(warnings.map((warning) => warning.code)).toEqual(["logging_dir_unwritable"]);
    expect(() => sink.append("access", accessEntry(0))).toThrow();
    expect(() => sink.append("audit", auditEntry(0))).toThrow();
  });

  it("restarts the chain and warns on a corrupt tail", () => {
    writeFileSync(logFilePath(dir, "audit"), "{not json}\n");

    const { sink, warnings } = createFileLogSink({ dir, maxBytes: 1024, keep: 1 });
    sink.append("audit", auditEntry(0));

    expect(warnings.map((warning) => warning.code)).toEqual(["logging_audit_chain_reset"]);
    const lines = readFileSync(logFilePath(dir, "audit"), "utf8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1] ?? "{}") as Record<string, unknown>;
    expect(last["seq"]).toBe(1);
  });
});
