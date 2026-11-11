import { describe, expect, it } from "vitest";

import type { AuditLogEntry } from "@facilis.dev/core";

import {
  canonicalJson,
  chainAuditEntry,
  computeAuditHash,
  isChainedAuditEntry,
  verifyAuditChain,
  type ChainedAuditEntry,
} from "./audit-chain.ts";

function auditEntry(operation: string): AuditLogEntry {
  return {
    kind: "audit",
    ts: "2026-11-08T12:00:00.000Z",
    level: "info",
    requestId: "request-12345678",
    method: "POST",
    path: "/api/order-requests",
    event: "order-request:cancel",
    actor: "user:user-1",
    userId: "user-1",
    operation,
    outcome: "succeeded",
    reason: "the request is cancelled by the owner",
    tables: ["order_requests"],
  };
}

function chain(count: number): ChainedAuditEntry[] {
  const entries: ChainedAuditEntry[] = [];
  let head: { seq: number; hash: string } | null = null;
  for (let index = 0; index < count; index += 1) {
    const entry = chainAuditEntry(auditEntry(`operation-${index}`), head);
    entries.push(entry);
    head = { seq: entry.seq, hash: entry.hash };
  }
  return entries;
}

function chainAt(entries: readonly ChainedAuditEntry[], index: number): ChainedAuditEntry {
  const entry = entries[index];
  if (entry === undefined) throw new Error(`missing chain entry ${index}`);
  return entry;
}

describe("canonicalJson", () => {
  it("is independent of key order and skips undefined", () => {
    expect(canonicalJson({ b: 2, a: 1, c: undefined })).toBe(canonicalJson({ a: 1, b: 2 }));
  });

  it("renders nested arrays and values stably", () => {
    expect(canonicalJson({ list: [1, "two", null], nested: { z: false } })).toBe(
      '{"list":[1,"two",null],"nested":{"z":false}}',
    );
  });
});

describe("chainAuditEntry", () => {
  it("starts at seq 1 without a prevHash", () => {
    const entry = chainAuditEntry(auditEntry("operation-0"), null);

    expect(entry.seq).toBe(1);
    expect(entry.prevHash).toBeUndefined();
    expect(entry.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("links each entry to its predecessor", () => {
    const entries = chain(3);

    expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(chainAt(entries, 1).prevHash).toBe(chainAt(entries, 0).hash);
    expect(chainAt(entries, 2).prevHash).toBe(chainAt(entries, 1).hash);
  });

  it("continues a chain from a rotated file's head", () => {
    const head = { seq: 7, hash: "a".repeat(64) };
    const entry = chainAuditEntry(auditEntry("operation-8"), head);

    expect(entry.seq).toBe(8);
    expect(entry.prevHash).toBe(head.hash);
  });
});

describe("verifyAuditChain", () => {
  it("accepts a good chain", () => {
    expect(verifyAuditChain(chain(4))).toEqual({ ok: true, entries: 4 });
  });

  it("accepts a rotated slice that starts mid-stream", () => {
    expect(verifyAuditChain(chain(4).slice(2))).toEqual({ ok: true, entries: 2 });
  });

  it("accepts an empty readback", () => {
    expect(verifyAuditChain([])).toEqual({ ok: true, entries: 0 });
  });

  it("detects a tampered field", () => {
    const entries = chain(3);
    entries[1] = { ...chainAt(entries, 1), event: "sudo:started" };

    const result = verifyAuditChain(entries);

    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.reason).toBe("hash-mismatch");
  });

  it("detects a reordered chain", () => {
    const entries = chain(3);
    const result = verifyAuditChain([
      chainAt(entries, 0),
      chainAt(entries, 2),
      chainAt(entries, 1),
    ]);

    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.reason).toBe("unexpected-sequence");
  });

  it("detects a broken link", () => {
    const entries = chain(3);
    // Valid internally, but claims the wrong predecessor: seq follows entry 0 while the
    // prevHash points at a hash that is not entry 0's.
    const planted = chainAuditEntry(auditEntry("operation-2"), { seq: 1, hash: "b".repeat(64) });

    const result = verifyAuditChain([chainAt(entries, 0), planted]);

    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.reason).toBe("prev-hash-mismatch");
  });

  it("rejects a first entry that claims seq 1 with a prevHash", () => {
    const entry = chainAuditEntry(auditEntry("operation-0"), { seq: 0, hash: "c".repeat(64) });
    const result = verifyAuditChain([entry]);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unexpected-prev-hash");
  });

  it("rejects a non-audit entry", () => {
    expect(verifyAuditChain([{ kind: "access", seq: 1 }]).reason).toBe("not-a-chained-audit-entry");
  });
});

describe("isChainedAuditEntry", () => {
  it("accepts a chained entry and rejects a plain one", () => {
    expect(isChainedAuditEntry(chain(1)[0])).toBe(true);
    expect(isChainedAuditEntry(auditEntry("operation-0"))).toBe(false);
    expect(isChainedAuditEntry(null)).toBe(false);
  });
});

describe("computeAuditHash", () => {
  it("matches the hash the chain wrote", () => {
    const [first] = chain(1);
    if (first === undefined) throw new Error("missing chain entry");

    const { hash, ...payload } = first;
    expect(computeAuditHash(payload)).toBe(hash);
  });
});
