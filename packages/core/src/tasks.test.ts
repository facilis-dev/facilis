import { describe, expect, it } from "vitest";

import { TaskError, serializeTaskData, unavailableTasks } from "./tasks.ts";

describe("serializeTaskData", () => {
  it("round-trips JSON data", () => {
    expect(serializeTaskData({ title: "Buy milk", count: 2 })).toEqual({ title: "Buy milk", count: 2 });
  });

  it("rejects data that cannot survive the JSON boundary", () => {
    expect(() => serializeTaskData(undefined)).toThrow(
      expect.objectContaining({ code: "task_invalid_input" }),
    );
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(() => serializeTaskData(circular)).toThrow(
      expect.objectContaining({ code: "task_invalid_input" }),
    );
  });
});

describe("unavailableTasks", () => {
  it("rejects every call with task_unavailable", async () => {
    const api = unavailableTasks();
    await expect(api.request({ titleKey: "x" })).rejects.toMatchObject({ code: "task_unavailable" });
    await expect(api.get("id")).rejects.toMatchObject({ code: "task_unavailable" });
    await expect(api.list()).rejects.toMatchObject({ code: "task_unavailable" });
    await expect(api.decide("id", { kind: "approve" })).rejects.toMatchObject({
      code: "task_unavailable",
    });
    await expect(api.cancel("id")).rejects.toMatchObject({ code: "task_unavailable" });
  });
});

describe("TaskError", () => {
  it("is a coded error with a stable name", () => {
    const error = new TaskError("task_expired", "expired");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TaskError");
    expect(error.code).toBe("task_expired");
  });
});
