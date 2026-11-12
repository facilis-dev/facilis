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

function preview(
  nodes: readonly PagePreviewNode[],
  truncated = false,
  routePaths: readonly string[] = [],
): PagePreview {
  return { routePaths, nodes, truncated };
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

/** The template's auth screen: PublicOnly > AuthLayout > LoginPage > AuthShell. */
function authShell(
  extra: readonly PagePreviewNode[] = [],
  routePaths: readonly string[] = ["/login"],
): PagePreview {
  return preview(
    [
      node("p0", null, "PublicOnly", "component"),
      node("p1", "p0", "AuthLayout", "component"),
      node("p2", "p1", "LoginPage", "component"),
      node("p3", "p1", "aside", "intrinsic"),
      node("p4", "p2", "AuthShell", "component"),
      node("p5", "p4", "footer", "slot"),
      node("p6", "p4", "Alert", "component", { dynamic: true }),
      ...extra,
    ],
    false,
    routePaths,
  );
}

/** The labelled controls the analyzer expands under a form in an auth card. */
function loginForm(): readonly PagePreviewNode[] {
  return [
    node("f0", "p4", "form", "intrinsic"),
    node("f1", "f0", "Field", "component"),
    node("f2", "f1", "Input", "component"),
    node("f3", "f0", "Field", "component"),
    node("f4", "f3", "Input", "component"),
    node("f5", "f0", "Button", "component", { tKey: "auth.login.submit" }),
  ];
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
    expect(sketch.layout).toBe("app");
    expect(sketch.header).toBe(true);
    expect(sketch.rail).toBe(true);
    expect(kinds(sketch)).toEqual(["board", "branch"]);
  });

  it("draws an auth screen as a brand panel beside a centred card", () => {
    const sketch = buildPageSketch(authShell(loginForm()));
    expect(sketch.layout).toBe("auth");
    expect(sketch.header).toBe(false);
    expect(sketch.rail).toBe(false);
    // The lone conditional alert is not a region; the card opens with its heading and closes
    // with the link to the sibling screen.
    expect(kinds(sketch)).toEqual(["heading", "form", "action"]);
    expect(sketch.blocks[1]?.fields).toBe(2);
  });

  it("spots an auth screen from the route table even without auth component names", () => {
    const sketch = buildPageSketch(
      preview(
        [
          node("p0", null, "Page", "component"),
          node("p1", "p0", "form", "intrinsic"),
          node("p2", "p1", "input", "intrinsic"),
        ],
        false,
        ["/register"],
      ),
    );
    expect(sketch.layout).toBe("auth");
    expect(kinds(sketch)).toEqual(["heading", "form"]);
    expect(sketch.blocks[1]?.fields).toBe(1);
  });

  it("turns an app page's form fields and its action into one form region", () => {
    const sketch = buildPageSketch(
      preview(
        [
          node("p0", null, "AppLayout", "component"),
          node("p1", "p0", "header", "intrinsic"),
          node("p2", "p0", "Page", "component"),
          node("p3", "p2", "form", "intrinsic"),
          node("p4", "p3", "Field", "component"),
          node("p5", "p4", "Input", "component"),
          node("p6", "p3", "Field", "component"),
          node("p7", "p6", "Input", "component"),
          node("p8", "p3", "Button", "component"),
        ],
        false,
        ["/settings"],
      ),
    );
    expect(sketch.layout).toBe("app");
    expect(kinds(sketch)).toEqual(["form"]);
    expect(sketch.blocks[0]?.fields).toBe(2);
  });

  it("caps the form rows the miniature draws", () => {
    const sketch = buildPageSketch(
      preview([
        node("p0", null, "Page", "component"),
        node("p1", "p0", "form", "intrinsic"),
        ...Array.from({ length: 5 }, (_, index) =>
          node("i" + String(index), "p1", "input", "intrinsic"),
        ),
      ]),
    );
    expect(sketch.blocks[0]?.fields).toBe(3);
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
    expect(sketch.layout).toBe("plain");
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
    expect(sketch.layout).toBe("app");
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
    expect(sketch.layout).toBe("plain");
    expect(kinds(sketch)).toEqual(["form"]);
    // A form the budget cut still keeps the minimum row.
    expect(sketch.blocks[0]?.fields).toBe(1);
  });

  it("falls back to a text region when the facts draw nothing", () => {
    const sketch = buildPageSketch(preview([]));
    expect(sketch.layout).toBe("plain");
    expect(sketch.header).toBe(false);
    expect(sketch.rail).toBe(false);
    expect(kinds(sketch)).toEqual(["text"]);
  });

  it("propagates the analyzer's truncation", () => {
    const sketch = buildPageSketch(preview([node("p0", null, "Page", "component")], true));
    expect(sketch.truncated).toBe(true);
  });
});
