import { describe, expect, it, vi } from "vitest";
import type { ProjectTemplate } from "../vv/project-manifest";
import { loadTemplateOnce } from "./template-loader";

const template: ProjectTemplate = {
  manifest: {
    id: "probe",
    name: "Probe",
    port: 3000,
    entry: "src/app.tsx",
    install: "npm install",
    dev: "npm run dev",
    hmr: true,
    reload: false,
  },
  files: {},
};

describe("template loader", () => {
  it("loads a template at most once per key", async () => {
    const load = vi.fn(async () => template);
    const [first, second] = await Promise.all([
      loadTemplateOnce("test-once", load),
      loadTemplateOnce("test-once", load),
    ]);
    expect(first).toBe(template);
    expect(second).toBe(template);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("drops a rejected import, so the next create can retry", async () => {
    let calls = 0;
    const load = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return template;
    });
    await expect(loadTemplateOnce("test-retry", load)).rejects.toThrow("offline");
    await expect(loadTemplateOnce("test-retry", load)).resolves.toBe(template);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
