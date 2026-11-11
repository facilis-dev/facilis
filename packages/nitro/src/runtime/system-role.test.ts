import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureSystemRole = vi.hoisted(() => vi.fn());

vi.mock("@facilis.dev/db", () => ({ ensureSystemRole }));

import type { FacilisDb } from "@facilis.dev/db";
import type { ManifestWarning } from "@facilis.dev/core";

import { provisionSystemRole } from "./system-role.ts";

const FAKE_DB = { driver: "pglite" } as unknown as FacilisDb;

beforeEach(() => {
  ensureSystemRole.mockReset();
});

describe("provisionSystemRole", () => {
  it("provisions the role without a warning", async () => {
    ensureSystemRole.mockResolvedValue(undefined);
    const warnings: ManifestWarning[] = [];

    await provisionSystemRole(FAKE_DB, warnings);

    expect(ensureSystemRole).toHaveBeenCalledWith(FAKE_DB);
    expect(warnings).toEqual([]);
  });

  it("reports a failed provisioning as a manifest warning instead of throwing", async () => {
    ensureSystemRole.mockRejectedValue(new Error("must be superuser to create roles"));
    const warnings: ManifestWarning[] = [];

    await expect(provisionSystemRole(FAKE_DB, warnings)).resolves.toBeUndefined();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: "system_role_failed",
      message: expect.stringContaining("must be superuser to create roles"),
    });
  });

  it("describes a non-Error rejection", async () => {
    ensureSystemRole.mockRejectedValue("permission denied");
    const warnings: ManifestWarning[] = [];

    await provisionSystemRole(FAKE_DB, warnings);

    expect(warnings[0]?.message).toContain("permission denied");
  });
});
