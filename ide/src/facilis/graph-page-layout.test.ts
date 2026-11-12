import { describe, expect, it } from "vitest";
import type { PagePreview, PagePreviewNode } from "@facilis.dev/analyze";
import { classifyPageLayout } from "./graph-page-layout";

const SOURCE = { file: "src/pages/page.tsx", line: 1 };

function node(name: string, kind: PagePreviewNode["kind"] = "component"): PagePreviewNode {
  return { id: name, parentId: null, name, kind, file: null, source: SOURCE, dynamic: false };
}

function preview(
  routePaths: readonly string[],
  nodes: readonly PagePreviewNode[] = [],
): PagePreview {
  return { routePaths, nodes, truncated: false };
}

const SHELL = { header: true, rail: true };
const BARE = { header: false, rail: false };

describe("classifyPageLayout", () => {
  it("spots auth screens from the resolved route table", () => {
    expect(classifyPageLayout(preview(["/login"]), BARE)).toBe("auth");
    expect(classifyPageLayout(preview(["/register"]), SHELL)).toBe("auth");
    expect(classifyPageLayout(preview(["/forgot-password"]), BARE)).toBe("auth");
    expect(classifyPageLayout(preview(["/sign-in"]), BARE)).toBe("auth");
  });

  it("falls back to auth component names when no route was resolved", () => {
    expect(classifyPageLayout(preview([], [node("AuthShell")]), BARE)).toBe("auth");
    expect(classifyPageLayout(preview([], [node("LoginPage")]), BARE)).toBe("auth");
    expect(classifyPageLayout(preview([], [node("RegisterPage")]), BARE)).toBe("auth");
  });

  it("keeps a shelled page as the app layout", () => {
    expect(classifyPageLayout(preview(["/todos"]), SHELL)).toBe("app");
    expect(classifyPageLayout(preview(["*"]), SHELL)).toBe("app");
  });

  it("draws a page with no shell and no auth meaning as bare", () => {
    expect(classifyPageLayout(preview(["*"], [node("NotFoundPage")]), BARE)).toBe("plain");
    expect(classifyPageLayout(preview(["/todos"]), BARE)).toBe("plain");
  });

  it("does not mistake the protected-route guard for an auth screen", () => {
    expect(classifyPageLayout(preview(["/todos"], [node("RequireAuth")]), SHELL)).toBe("app");
  });
});
