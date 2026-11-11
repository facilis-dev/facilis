import { describe, expect, it } from "vitest";

import { createDb } from "@facilis/db";
import type { ManifestWarning } from "@facilis/core";

import { bootTasks } from "./boot.ts";
import { TENANT_ID, createTasksTestContext } from "./tasks-test-harness.ts";

describe("bootTasks", () => {
  it("disables the API with a warning when the table is missing", async () => {
    const db = await createDb();
    try {
      const warnings: ManifestWarning[] = [];
      await expect(bootTasks({ db, tenantId: TENANT_ID, warnings })).resolves.toBeNull();
      expect(warnings.map((warning) => warning.code)).toEqual(["tasks_table_missing"]);
    } finally {
      await db.close();
    }
  });

  it("boots the store and serves request/list", async () => {
    const { db } = await createTasksTestContext();
    try {
      const warnings: ManifestWarning[] = [];
      const runtime = await bootTasks({ db, tenantId: TENANT_ID, warnings });
      if (runtime === null) throw new Error("the task runtime did not boot");
      expect(warnings).toEqual([]);

      const created = await runtime.api.request({
        titleKey: "todos.approval",
        titleParams: { title: "Buy milk" },
      });
      expect(created.status).toBe("pending");
      const pending = await runtime.api.list({ status: "pending" });
      expect(pending.map((task) => task.id)).toEqual([created.id]);
    } finally {
      await db.close();
    }
  });
});
