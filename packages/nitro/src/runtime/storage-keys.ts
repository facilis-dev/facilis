import {
  SecretString,
  type FacilisRuntimeConfig,
  type JsonValue,
} from "@facilis.dev/core";
import { isValidEncryptionKeyId, type StorageEncryptionKeys } from "@facilis.dev/storage";

import { runtimeSecret, runtimeString } from "./runtime-values.ts";

/**
 * Resolve the optional at-rest encryption keys from the runtime section (D-117, D-224).
 *
 * The active key encrypts new blobs; retired keys only decrypt blobs whose header names
 * them, which is what makes rotation possible without rewriting content-addressed bodies.
 * Values are base64 (recommended) or 64-character hex, and must decode to 32 bytes.
 */

const DEFAULT_KEY_ID = "primary";
const KEY_BYTES = 32;

export type EncryptionKeyResolution =
  | { readonly keys: StorageEncryptionKeys }
  | { readonly keys: null; readonly problem: "missing" | "invalid"; readonly message: string };

export function resolveEncryptionKeys(runtime: FacilisRuntimeConfig): EncryptionKeyResolution {
  const rawKey = runtimeSecret(runtime, "storageEncryptionKey");
  if (rawKey === null) {
    return {
      keys: null,
      problem: "missing",
      message:
        "Set FACILIS_STORAGE_ENCRYPTION_KEY (base64 or hex, 32 bytes) because storage.encryption.enabled is true.",
    };
  }
  const keyId = runtimeString(runtime, "storageEncryptionKeyId")?.trim() ?? DEFAULT_KEY_ID;
  if (!isValidEncryptionKeyId(keyId)) {
    return invalid("FACILIS_STORAGE_ENCRYPTION_KEY_ID must match [A-Za-z0-9._-]{1,64}.");
  }
  const activeKey = decodeKey(rawKey);
  if (activeKey === null) {
    return invalid("FACILIS_STORAGE_ENCRYPTION_KEY must be a base64 or hex 32-byte key.");
  }

  // Null-prototype record: key ids are validated, but __proto__ must still never become an
  // inherited value instead of an own key.
  const keys: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  keys[keyId] = activeKey;
  const retiredRaw = retiredKeysValue(runtime);
  if (retiredRaw !== undefined && retiredRaw !== null) {
    let parsed: unknown;
    if (retiredRaw instanceof SecretString) {
      try {
        parsed = JSON.parse(retiredRaw.reveal());
      } catch {
        return invalid(
          "FACILIS_STORAGE_ENCRYPTION_RETIRED_KEYS must be a JSON object of key id to key.",
        );
      }
    } else {
      parsed = retiredRaw;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return invalid(
        "FACILIS_STORAGE_ENCRYPTION_RETIRED_KEYS must be a JSON object of key id to key.",
      );
    }
    for (const [retiredId, value] of Object.entries(parsed)) {
      if (!isValidEncryptionKeyId(retiredId)) {
        return invalid('Retired encryption key id "' + retiredId + '" is not a valid key id.');
      }
      if (Object.hasOwn(keys, retiredId)) {
        return invalid('Encryption key id "' + retiredId + '" is both active and retired.');
      }
      if (typeof value !== "string") {
        return invalid('Retired encryption key "' + retiredId + '" must be a string.');
      }
      const decoded = decodeKey(value);
      if (decoded === null) {
        return invalid('Retired encryption key "' + retiredId + '" must be 32 bytes.');
      }
      keys[retiredId] = decoded;
    }
  }
  return { keys: { activeKeyId: keyId, keys } };
}

function decodeKey(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return new Uint8Array(Buffer.from(trimmed, "hex"));
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  const decoded = Buffer.from(trimmed, "base64");
  return decoded.length === KEY_BYTES ? new Uint8Array(decoded) : null;
}

/** The retired-key map is a secret boxed as JSON text, or a declared literal object. */
function retiredKeysValue(runtime: FacilisRuntimeConfig): JsonValue | SecretString | undefined {
  return runtime["storageEncryptionRetiredKeys"];
}

function invalid(message: string): EncryptionKeyResolution {
  return { keys: null, problem: "invalid", message };
}
