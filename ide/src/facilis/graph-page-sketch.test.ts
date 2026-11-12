import { describe, expect, it } from "vitest";
import type { PagePreview, PagePreviewNode } from "@facilis.dev/analyze";
import { buildPageSketch, type PageSketch } from "./graph-page-sketch";

const SOURCE = { file: "src/pages/page.tsx", line: 1 };

function node(
  id: string,
  parentId: string | null,
  name: string,
  kind: PagePreviewNode["kind"],
  extra: Partial<PagePreviewNode> = {},
): PagePreviewNode {
  return { id, parentId, name, kind, file: null, source: SOURCE, dynamic: false, ...extra };
}

function preview(nodes: readonly PagePreviewNode[], truncated = false): PagePreview {
  return { routePaths: [], nodes, truncated };
}

function kinds(sketch: PageSketch): readonly string[] {
  return sketch.blocks.map((block) => block.kind);
}

/** The template's app shell: a layout component wrapping aside + header + main. */
function appShell(content: readonly PagePreviewNode[]): PagePreview {
  return preview([
    node("p0", null, "AppLayout", "component"),
    node("p1", "p0", "aside", "intrinsic"),
    node("p2", "p0", "header", "intrinsic"),
    node("p3", "p0", "main", "intrinsic"),
    node("p4", "p3", "RequireAuth", "component"),
    node("p5", "p4", "TodosPage", "component"),
    node("p6", "p5", "Page", "component"),
    ...content.map((entry, index) => ({ ...entry, parentId: "p6", id: "c" + String(index) })),
  ]);
}

describe("buildPageSketch", () => {
  it("draws the app shell and flattens the component wrapper chain", () => {
    const sketch = buildPageSketch(
      appShell([
        node("a", "p6", "TodoForm", "component"),
        node("b", "p6", "Skeleton", "component", { dynamic: true }),
        node("c", "p6", "TodoTable", "component", { dynamic: true }),
      ]),
    );
    expect(sketch.header).toBe(true);
    expect(sketch.rail).toBe(true);
    expect(kinds(sketch)).toEqual(["board", "branch"]);
  });

  it("turns a form's fields and its action into one form region", () => {
    const sketch = buildPageSketch(
      preview([
        node("p0", null, "PublicOnly", "component"),
        node("p1", "p0", "AuthLayout", "component"),
        node("p2", "p1", "LoginPage", "component"),
        node("p3", "p1", "aside", "intrinsic"),
        node("p4", "p2", "AuthShell", "component"),
        node("p5", "p4", "footer", "slot"),
        node("p6", "p4", "Alert", "component", { dynamic: true }),
        node("p7", "p4", "form", "intrinsic"),
        node("p8", "p7", "Field", "component"),
        node("p9", "p8", "Input", "component"),
        node("p10", "p7", "Button", "component"),
        node("p11", "p4", "a", "intrinsic", { dynamic: true }),
      ]),
    );
    expect(sketch.rail).toBe(true);
    expect(sketch.header).toBe(false);
    // The lone conditional alert and the conditional footer link are not regions of their own.
    expect(kinds(sketch)).toEqual(["form"]);
  });

  it("skips overlay components: a dialog is not part of the resting page", () => {
    const sketch = buildPageSketch(
      preview([
        node("p0", null, "Page", "component"),
        node("p1", "p0", "TodoTable", "component"),
        node("p2", "p0", "Dialog", "component"),
        node("p3", "p2", "DialogContent", "component"),
        node("p4", "p3", "DialogTitle", "component"),
        node("p5", "p3", "Button", "component"),
      ]),
    );
    expect(kinds(sketch)).toEqual(["board"]);
  });

  it("keeps a nav inside the header out of the rail", () => {
    const sketch = buildPageSketch(
      preview([
        node("p0", null, "Page", "component"),
        node("p1", "p0", "header", "intrinsic"),
        node("p2", "p1", "nav", "intrinsic"),
      ]),
    );
    expect(sketch.header).toBe(true);
    expect(sketch.rail).toBe(false);
  });

  it("merges consecutive copy into one text region", () => {
    const sketch = buildPageSketch(
      preview([
        node("p0", null, "Page", "component"),
        node("p1", "p0", "h1", "intrinsic", { text: "Title" }),
        node("p2", "p0", "p", "intrinsic", { tKey: "copy.body" }),
        node("p3", "p0", "p", "intrinsic"),
      ]),
    );
    expect(kinds(sketch)).toEqual(["text"]);
  });

  it("caps the content at four regions and keeps document order", () => {
    const nodes = [
      node("p0", null, "Page", "component"),
      ...Array.from({ length: 6 }, (_, index) =>
        node("p" + String(index + 1), "p0", "Card" + String(index), "component"),
      ),
    ];
    const sketch = buildPageSketch(preview(nodes));
    expect(sketch.blocks).toHaveLength(4);
    expect(kinds(sketch)).toEqual(["board", "board", "board", "board"]);
  });

  it("promotes a node whose parent the analyzer cut to a root", () => {
    const sketch = buildPageSketch(preview([node("p0", "missing", "form", "intrinsic")]));
    expect(kinds(sketch)).toEqual(["form"]);
  });

  it("falls back to a text region when the facts draw nothing", () => {
    const sketch = buildPageSketch(preview([]));
    expect(sketch.header).toBe(false);
    expect(sketch.rail).toBe(false);
    expect(kinds(sketch)).toEqual(["text"]);
  });

  it("propagates the analyzer's truncation", () => {
    const sketch = buildPageSketch(preview([node("p0", null, "Page", "component")], true));
    expect(sketch.truncated).toBe(true);
  });
});
