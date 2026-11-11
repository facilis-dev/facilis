import { describe, expect, it } from "vitest";

import { unavailableStorage, type AuthContext, type StorageApi } from "@facilis.dev/core";

import {
  fileHeaders,
  sanitizeFileName,
  sanitizeMime,
  sendStoredFile,
  storeUpload,
} from "./storage.ts";

const AUTH: AuthContext = {
  userId: "00000000-0000-4000-8000-000000000001",
  roles: [],
  permissions: [],
};

function streamOf(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield bytes;
  })();
}

function availableStorage(overrides: Partial<StorageApi> = {}): StorageApi {
  return {
    kind: "local",
    available: true,
    maxUploadBytes: 1024,
    put: async () => ({ hash: "a".repeat(64), size: 5 }),
    get: async () => streamOf(new Uint8Array([1, 2, 3])),
    exists: async () => true,
    delete: async () => {},
    buildDownloadUrl: () => "/api/files/x?token=t",
    verifyDownloadToken: () => null,
    ...overrides,
  };
}

function uploadInput(file: File, storage: StorageApi) {
  return {
    event: { context: {}, req: { headers: new Headers() } } as never,
    db: {} as never,
    storage,
    auth: AUTH,
    file,
  };
}

async function codeOf(result: Response): Promise<string | undefined> {
  return ((await result.json()) as { code?: string }).code;
}

describe("storeUpload", () => {
  it("fails with storage_unavailable when the runtime did not boot", async () => {
    const result = await storeUpload(
      uploadInput(new File(["hello"], "note.txt"), unavailableStorage()),
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(503);
    expect(await codeOf(result as Response)).toBe("storage_unavailable");
  });

  it("fails with file_too_large before reading the body", async () => {
    const result = await storeUpload(
      uploadInput(new File(["hello"], "note.txt"), availableStorage({ maxUploadBytes: 2 })),
    );
    expect((result as Response).status).toBe(413);
    expect(await codeOf(result as Response)).toBe("file_too_large");
  });

  it("rejects an anonymous upload", async () => {
    const input = uploadInput(new File(["hello"], "note.txt"), availableStorage());
    const result = await storeUpload({ ...input, auth: null });
    expect((result as Response).status).toBe(401);
  });
});

describe("sendStoredFile", () => {
  it("fails with storage_unavailable when the runtime did not boot", async () => {
    const result = await sendStoredFile({
      db: {} as never,
      storage: unavailableStorage(),
      fileId: "00000000-0000-4000-8000-000000000001",
      token: "token",
    });
    expect(result.status).toBe(503);
  });

  it("answers not_found for an invalid token before touching the database", async () => {
    const result = await sendStoredFile({
      db: {} as never,
      storage: availableStorage(),
      fileId: "00000000-0000-4000-8000-000000000001",
      token: "bad",
    });
    expect(result.status).toBe(404);
    expect(await codeOf(result)).toBe("not_found");
  });
});

describe("file header helpers", () => {
  it("sanitizes the display name and strips path separators", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("a\u0000b.txt")).toBe("ab.txt");
    expect(sanitizeFileName("   ")).toBe("file");
  });

  it("only echoes a syntactically valid MIME type", () => {
    expect(sanitizeMime("image/png")).toBe("image/png");
    expect(sanitizeMime("text/html; x=1")).toBe("application/octet-stream");
    expect(sanitizeMime("")).toBe("application/octet-stream");
  });

  it("always serves user files as attachments with nosniff", () => {
    const headers = fileHeaders("image/png", "photo.png", 3);
    expect(headers.get("content-type")).toBe("image/png");
    expect(headers.get("content-disposition")).toContain('attachment; filename="photo.png"');
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-security-policy")).toBe("sandbox");
  });
});
