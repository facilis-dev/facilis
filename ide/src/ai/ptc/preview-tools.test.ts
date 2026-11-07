import { describe, expect, it } from "vitest";
import { analyzeHostFiles } from "../analysis-fixtures";
import type { PatchValidationHost } from "../patch-validation";
import type { PreviewAccess } from "../preview-access";
import { isPtcToolError, type PtcJson } from "./protocol";
import { createToolRouter } from "./tools";

function access(overrides: Partial<PreviewAccess> = {}): PreviewAccess {
  return {
    available: () => true,
    state: async () => ({ url: "/", title: "Todos", readyState: "complete" }),
    console: () => ({ available: true, errors: [], warnings: [], exceptions: [], entries: [] }),
    network: () => ({ available: true, failures: [], recent: [], total: 0 }),
    dom: async (selector, maxChars) => ({ matched: selector !== null, selector, maxChars }),
    click: async (selector) => ({ ok: true, selector }),
    fill: async (selector, text) => ({ ok: true, selector, text }),
    open: async (path) => ({ ok: true, path }),
    wait: async (selector, ms) => ({ ok: true, selector, ms }),
    screenshot: async () => ({ captured: true, width: 800, height: 600 }),
    takeImages: () => [],
    ...overrides,
  };
}

function host(preview: PreviewAccess | undefined): PatchValidationHost {
  const files = () => ["facilis.config.ts", "src/App.tsx"];
  const read = async (path: string) =>
    path === "src/App.tsx" ? "export const App = () => null;\n" : "";
  return {
    files,
    read,
    manifestBase: () => null,
    syntaxChecker: () => ({ check: async () => [] }),
    analyze: (patches) => analyzeHostFiles(files(), read, patches),
    ...(preview === undefined ? {} : { preview }),
  };
}

async function call(
  name: string,
  args: unknown,
  preview: PreviewAccess | null = access(),
): Promise<PtcJson> {
  return createToolRouter(host(preview ?? undefined)).execute({ name, args }, {});
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (isPtcToolError(error)) return error;
    throw error;
  }
  throw new Error("expected the tool call to be refused");
}

describe("preview tools", () => {
  it("advertises the preview tools only when the host has a preview", () => {
    const withPreview = createToolRouter(host(access()))
      .specs()
      .map((spec) => spec.name);
    const without = createToolRouter(host(undefined))
      .specs()
      .map((spec) => spec.name);
    expect(withPreview).toContain("preview_state");
    expect(withPreview).toContain("preview_network");
    expect(without).not.toContain("preview_state");
  });

  it("reads the app state and reports a not-running app as data", async () => {
    await expect(call("preview_state", {})).resolves.toMatchObject({ title: "Todos" });
    const offline = access({ available: () => false });
    await expect(call("preview_state", {}, offline)).resolves.toMatchObject({
      available: false,
    });
  });

  it("clicks, fills and forwards the arguments", async () => {
    await expect(call("preview_click", { selector: "button.upload" })).resolves.toMatchObject({
      ok: true,
      selector: "button.upload",
    });
    await expect(
      call("preview_fill", { selector: "input[name=title]", text: "ciao" }),
    ).resolves.toMatchObject({ ok: true, text: "ciao" });
    await expect(call("preview_dom", { selector: "form", maxChars: 500 })).resolves.toMatchObject({
      matched: true,
      maxChars: 500,
    });
  });

  it("validates selectors, routes and sizes", async () => {
    const missing = await refusal(call("preview_click", {}));
    expect(missing.message).toContain("selector");
    const longSelector = await refusal(call("preview_click", { selector: "x".repeat(400) }));
    expect(longSelector.message).toContain("300");
    const badChars = await refusal(call("preview_dom", { maxChars: 5 }));
    expect(badChars.message).toContain("200");
    for (const path of ["http://evil", "//evil", "/../etc", "relative"]) {
      const route = await refusal(call("preview_open", { path }));
      expect(route.message).toContain("project route");
    }
    const noWait = await refusal(call("preview_wait", {}));
    expect(noWait.message).toContain("selector or ms");
  });

  it("takes a screenshot and reports it", async () => {
    await expect(call("preview_screenshot", {})).resolves.toMatchObject({
      captured: true,
      width: 800,
    });
  });

  it("waits for a selector or a delay", async () => {
    await expect(call("preview_wait", { selector: "#main" })).resolves.toMatchObject({ ok: true });
    await expect(call("preview_wait", { ms: 300 })).resolves.toMatchObject({ ms: 300 });
  });

  it("degrades to 'not implemented' when the host has no preview", async () => {
    const error = await refusal(call("preview_state", {}, null));
    expect(error.message).toContain("not implemented");
  });
});
