import { createHash } from "node:crypto";

import type { AuditLogEntry } from "@facilis.dev/core";

/**
 * Tamper-evident audit chain (D-119, O-014).
 *
 * File-written audit entries carry a sequence number, the previous entry's hash and their own
 * SHA-256 hash over a canonical JSON rendering. The chain is tamper-EVIDENT, not tamper-proof:
 * it has no secret key, so a writer who can rewrite the file can rebuild the chain. WORM or
 * external retention is the deploy's responsibility (stdout/file shipped to a store it cannot
 * rewrite). The chain restarts at seq 1 in a fresh file so a rotated file is still verifiable
 * on its own, from its first entry's `prevHash` onward.
 */

export const AUDIT_CHAIN_HASH_ALGORITHM = "sha256";
const HASH_PATTERN = /^[a-f0-9]{64}$/;

/** Where the next chained entry starts: the last entry of the active file. */
export interface AuditChainHead {
  readonly seq: number;
  readonly hash: string;
}

export interface ChainedAuditEntry extends AuditLogEntry {
  /** 1-based position in the stream; continues across rotations and restarts. */
  readonly seq: number;
  /** Hash of the previous entry; absent only on the first entry of a fresh chain. */
  readonly prevHash?: string;
  /** SHA-256 of the canonical entry without this field (it covers `seq` and `prevHash`). */
  readonly hash: string;
}

/** Everything the hash covers: the entry plus its chain position, minus the hash itself. */
export type AuditChainPayload = Omit<ChainedAuditEntry, "hash">;

export interface AuditChainVerification {
  readonly ok: boolean;
  readonly entries: number;
  /** 0-based index of the first broken entry; absent when `ok`. */
  readonly brokenAt?: number;
  /** Stable reason code for the first break, e.g. `hash-mismatch`. */
  readonly reason?: string;
}

/**
 * Stable JSON rendering: object keys sorted, no whitespace, `undefined` fields absent.
 * Two entries with the same field values always hash the same, regardless of key order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(object).sort()) {
    const item = object[key];
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
  }
  return `{${parts.join(",")}}`;
}

/** Canonical hash of an entry position; exported so a readback tool can recompute it. */
export function computeAuditHash(payload: AuditChainPayload): string {
  return createHash(AUDIT_CHAIN_HASH_ALGORITHM)
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

/** Appends one entry to the chain; `head` is null for the first entry of a fresh file. */
export function chainAuditEntry(
  entry: AuditLogEntry,
  head: AuditChainHead | null,
): ChainedAuditEntry {
  const seq = head === null ? 1 : head.seq + 1;
  const payload: AuditChainPayload = {
    ...entry,
    seq,
    ...(head === null ? {} : { prevHash: head.hash }),
  };
  return { ...payload, hash: computeAuditHash(payload) };
}

/** Structural check used when reading a file back; malformed hashes fail the check. */
export function isChainedAuditEntry(value: unknown): value is ChainedAuditEntry {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate["kind"] === "audit" &&
    Number.isSafeInteger(candidate["seq"]) &&
    typeof candidate["hash"] === "string" &&
    HASH_PATTERN.test(candidate["hash"]) &&
    (candidate["prevHash"] === undefined ||
      (typeof candidate["prevHash"] === "string" && HASH_PATTERN.test(candidate["prevHash"])))
  );
}

/**
 * Verifies a readback: every entry's hash and every consecutive link.
 *
 * The first entry may start at any `seq` (a rotated file starts mid-stream); when it starts at
 * seq 1 it must not carry a `prevHash`. Only entries given are verified, so verifying
 * `access.1.jsonl` (rotated) checks the links inside that file, not the link to the active one.
 */
export function verifyAuditChain(entries: readonly unknown[]): AuditChainVerification {
  let previous: ChainedAuditEntry | null = null;
  for (const [index, entry] of entries.entries()) {
    if (!isChainedAuditEntry(entry)) {
      return broken(index, "not-a-chained-audit-entry");
    }
    if (index === 0) {
      if (entry.seq === 1 && entry.prevHash !== undefined) {
        return broken(index, "unexpected-prev-hash");
      }
      if (entry.seq > 1 && entry.prevHash === undefined) {
        return broken(index, "missing-prev-hash");
      }
    } else if (previous !== null) {
      if (entry.seq !== previous.seq + 1) return broken(index, "unexpected-sequence");
      if (entry.prevHash !== previous.hash) return broken(index, "prev-hash-mismatch");
    }
    const { hash, ...payload } = entry;
    if (computeAuditHash(payload) !== hash) return broken(index, "hash-mismatch");
    previous = entry;
  }
  return { ok: true, entries: entries.length };
}

function broken(brokenAt: number, reason: string): AuditChainVerification {
  return { ok: false, entries: brokenAt, brokenAt, reason };
}
