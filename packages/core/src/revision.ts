import type { BlockManifest, LocaleCatalogs } from "./manifest.ts";

/**
 * Deterministic revision hashing (SPEC §6.5).
 *
 * The revision is an ETag/clients' freshness token: it must depend only on project inputs,
 * never on file order or JSON key order, and must be identical in Node and in the browser.
 * WebCrypto (`globalThis.crypto.subtle`) exists in both, so no `node:crypto` import is needed.
 */

export interface SchemaFileRevisionSource {
  /** Project-relative path; part of the hash so renames invalidate the revision. */
  readonly path: string;
  readonly content: string;
}

export interface BlockManifestRevisionSource {
  /** Path of the block manifest file, used only to order/hash the source. */
  readonly path: string;
  readonly manifest: BlockManifest;
}

export interface RevisionInput {
  /** Raw `facilis.config.ts` source text. */
  readonly configContent: string;
  readonly schemaFiles?: readonly SchemaFileRevisionSource[];
  readonly openApiSpec?: unknown;
  readonly blockManifests?: readonly BlockManifestRevisionSource[];
  readonly localeCatalogs?: LocaleCatalogs;
}

interface WebCryptoLike {
  readonly subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  };
}

const SEPARATOR = "\u0000";
const textEncoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha1Hex(value: string): Promise<string> {
  const webCrypto = (globalThis as unknown as { crypto?: WebCryptoLike }).crypto;
  if (webCrypto === undefined) {
    throw new Error("computeRevision requires globalThis.crypto.subtle (WebCrypto)");
  }
  const digest = await webCrypto.subtle.digest("SHA-1", textEncoder.encode(value));
  return toHex(digest);
}

/** JSON with object keys sorted recursively, so equivalent specs hash identically. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .toSorted()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? "null";
}

function sortedEntries<T>(entries: readonly T[], pathOf: (entry: T) => string): readonly T[] {
  return entries.toSorted((left, right) => pathOf(left).localeCompare(pathOf(right)));
}

/**
 * SHA-1 over the concatenated hashes of config, schema sources, OpenAPI spec, block manifests
 * and locale catalogues (SPEC §6.5). Recomputed on demand; no watchers required.
 */
export async function computeRevision(input: RevisionInput): Promise<string> {
  const schemaHash = await sha1Hex(
    sortedEntries(input.schemaFiles ?? [], (file) => file.path)
      .map((file) => `${file.path}${SEPARATOR}${file.content}`)
      .join("\n"),
  );
  const openApiHash = await sha1Hex(canonicalJson(input.openApiSpec ?? {}));
  const blocksHash = await sha1Hex(
    sortedEntries(input.blockManifests ?? [], (source) => source.path)
      .map((source) => `${source.path}${SEPARATOR}${canonicalJson(source.manifest)}`)
      .join("\n"),
  );
  const localesHash = await sha1Hex(canonicalJson(input.localeCatalogs ?? {}));
  const configHash = await sha1Hex(input.configContent);

  return sha1Hex([configHash, schemaHash, openApiHash, blocksHash, localesHash].join("\n"));
}
