import { describe, expect, it } from "vitest";

import { StorageUnavailableError, unavailableStorage } from "./storage.ts";

describe("unavailableStorage", () => {
  it("reports itself unavailable without throwing on construction", () => {
    const storage = unavailableStorage();
    expect(storage.available).toBe(false);
    expect(storage.kind).toBe("none");
    expect(storage.maxUploadBytes).toBe(0);
  });

  it("fails byte operations with the storage_unavailable code", async () => {
    const storage = unavailableStorage();
    await expect(storage.put((async function* () {})())).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );
    await expect(storage.get("a".repeat(64))).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(storage.exists("a".repeat(64))).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(storage.delete("a".repeat(64))).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it("has no URL to build and verifies no token", () => {
    const storage = unavailableStorage();
    expect(storage.buildDownloadUrl("00000000-0000-4000-8000-000000000001")).toBe("");
    expect(storage.verifyDownloadToken("token", "00000000-0000-4000-8000-000000000001")).toBeNull();
  });
});
