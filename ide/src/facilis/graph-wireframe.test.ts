import { describe, expect, it } from "vitest";
import type { PagePreview, PagePreviewNode } from "@facilis.dev/analyze";
import { buildPageWireframe, wireframeTagOf, type WireframeNode } from "./graph-wireframe";

const SOURCE = { file: "src/pages/index.tsx", line: 1 };

function node(id: string, overrides: Partial<PagePreviewNode> = {}): PagePreviewNode {
  return {
    id,
    parentId: null,
    name: "div",
    kind: "intrinsic",
    file: null,
    source: SOURCE,
    dynamic: false,
    ...overrides,
  };
}

function previewOf(nodes: readonly PagePreviewNode[], truncated = false): PagePreview {
  return { routePaths: ["/"], nodes, truncated };
}

const NO_LOCALES = {};

const LOCALES = {
  en: { "home.title": "Home", "home.cta": "Go now" },
  it: { "home.title": "Casa" },
};

describe("wireframeTagOf", () => {
  it.each([
    ["header", "bar"],
    ["footer", "bar"],
    ["nav", "nav"],
    ["aside", "nav"],
    ["main", "main"],
    ["section", "section"],
    ["article", "section"],
    ["div", "section"],
    ["form", "section"],
    ["table", "section"],
    ["ul", "list"],
    ["ol", "list"],
    ["li", "list"],
    ["button", "action"],
    ["a", "action"],
    ["input", "field"],
    ["select", "field"],
    ["textarea", "field"],
    ["label", "field"],
    ["img", "media"],
    ["picture", "media"],
    ["video", "media"],
    ["p", "text"],
    ["h1", "text"],
    ["h4", "text"],
    ["h5", "text"],
    ["h6", "text"],
    ["span", "text"],
    ["strong", "text"],
    ["em", "text"],
    ["small", "text"],
    ["b", "text"],
    ["i", "text"],
    ["code", "text"],
    ["pre", "text"],
    ["blockquote", "text"],
    ["audio", "media"],
    ["custom-element", "other"],
  ])("maps the intrinsic <%s> to %s", (name, tag) => {
    expect(wireframeTagOf(node("n", { name }))).toBe(tag);
  });

  it("keeps the component and slot kinds, case-insensitively for intrinsic names", () => {
    expect(wireframeTagOf(node("n", { name: "Header", kind: "component" }))).toBe("component");
    expect(wireframeTagOf(node("n", { name: "children", kind: "slot" }))).toBe("slot");
    expect(wireframeTagOf(node("n", { name: "HEADER" }))).toBe("bar");
  });
});

describe("buildPageWireframe labels", () => {
  it("keeps the JSX name, the rendering site to open and the definition as a hint", () => {
    const wireframe = buildPageWireframe(
      previewOf([
        node("n1", {
          name: "TodoList",
          kind: "component",
          file: "src/components/todo-list.tsx",
          source: { file: "src/pages/index.tsx", line: 12 },
        }),
      ]),
      NO_LOCALES,
      "en",
    );
    const [root] = wireframe.roots;
    expect(root?.label).toBe("TodoList");
    // The definition file is a hint; the click target is the JSX site where it renders.
    expect(root?.definitionFile).toBe("src/components/todo-list.tsx");
    expect(root?.file).toBe("src/pages/index.tsx");
    expect(root?.line).toBe(12);
  });

  it("opens the rendering site even when the component definition is unknown", () => {
    const wireframe = buildPageWireframe(
      previewOf([node("n1", { source: { file: "src/pages/index.tsx", line: 7 } })]),
      NO_LOCALES,
      "en",
    );
    expect(wireframe.roots[0]?.definitionFile).toBeNull();
    expect(wireframe.roots[0]?.file).toBe("src/pages/index.tsx");
    expect(wireframe.roots[0]?.line).toBe(7);
  });
});

function wireframeText(
  content: Pick<PagePreviewNode, "text" | "tKey">,
  defaultLocale: string | null,
): string | null {
  const wireframe = buildPageWireframe(
    previewOf([node("n1", { name: "p", ...content })]),
    LOCALES,
    defaultLocale,
  );
  return wireframe.roots[0]?.text ?? null;
}

describe("buildPageWireframe text resolution", () => {
  it("prefers the default locale catalogue", () => {
    expect(wireframeText({ tKey: "home.title" }, "it")).toBe("Casa");
  });

  it("falls back to English when the default locale misses the key", () => {
    expect(wireframeText({ tKey: "home.cta" }, "it")).toBe("Go now");
  });

  it("falls back to English when the project has no default locale or an unknown one", () => {
    expect(wireframeText({ tKey: "home.title" }, null)).toBe("Home");
    expect(wireframeText({ tKey: "home.title" }, "fr")).toBe("Home");
  });

  it("returns null when the key exists nowhere", () => {
    expect(wireframeText({ tKey: "home.missing" }, "it")).toBeNull();
  });

  it("prefers a resolved tKey over the literal source text", () => {
    expect(wireframeText({ text: "Home (fallback)", tKey: "home.title" }, "it")).toBe("Casa");
  });

  it("uses the literal text child when there is no tKey", () => {
    expect(wireframeText({ text: "Hello there" }, "en")).toBe("Hello there");
  });

  it("returns null when the node has neither text nor a tKey", () => {
    expect(wireframeText({}, "en")).toBeNull();
  });
});

describe("buildPageWireframe content blocks", () => {
  it("draws paragraphs, headings and inline copy as text blocks with their copy", () => {
    const wireframe = buildPageWireframe(
      previewOf([
        node("n1", { name: "section" }),
        node("p1", { parentId: "n1", name: "p", text: "Nothing here yet" }),
        node("h1", { parentId: "n1", name: "h4", text: "Filters" }),
        node("s1", { parentId: "p1", name: "strong", text: "Note" }),
      ]),
      NO_LOCALES,
      "en",
    );
    const section = wireframe.roots[0];
    expect(section?.children.map((child) => [child.tag, child.text])).toEqual([
      ["text", "Nothing here yet"],
      ["text", "Filters"],
    ]);
    // Inline copy nests under its paragraph, so the block keeps its own text and children.
    expect(section?.children[0]?.children.map((child) => child.text)).toEqual(["Note"]);
  });

  it("exposes control copy: button text, input placeholder and img alt", () => {
    const wireframe = buildPageWireframe(
      previewOf([
        node("n1", { name: "form" }),
        node("b1", { parentId: "n1", name: "button", text: "Add" }),
        node("i1", { parentId: "n1", name: "input", text: "Search" }),
        node("m1", { parentId: "n1", name: "img", text: "Logo" }),
      ]),
      NO_LOCALES,
      "en",
    );
    expect(wireframe.roots[0]?.children.map((child) => [child.tag, child.text])).toEqual([
      ["action", "Add"],
      ["field", "Search"],
      ["media", "Logo"],
    ]);
  });

  it("resolves a control's tKey the same way as a heading", () => {
    const wireframe = buildPageWireframe(
      previewOf([node("b1", { name: "button", text: "Home (fallback)", tKey: "home.title" })]),
      LOCALES,
      "it",
    );
    expect(wireframe.roots[0]?.text).toBe("Casa");
  });
});

describe("buildPageWireframe tree", () => {
  it("nests children under their parent and keeps multiple roots in input order", () => {
    const wireframe = buildPageWireframe(
      previewOf([
        node("r1", { name: "header" }),
        node("r2", { name: "main" }),
        node("c1", { parentId: "r1", name: "nav" }),
        node("c2", { parentId: "r2", name: "section" }),
        node("g1", { parentId: "c2", name: "p" }),
      ]),
      NO_LOCALES,
      "en",
    );
    expect(wireframe.roots.map((root) => root.id)).toEqual(["r1", "r2"]);
    expect(wireframe.roots.map((root) => root.children.map((child) => child.id))).toEqual([
      ["c1"],
      ["c2"],
    ]);
    expect(wireframe.roots[1]?.children[0]?.children.map((grandchild) => grandchild.id)).toEqual([
      "g1",
    ]);
    expect(wireframe.count).toBe(5);
  });

  it("promotes a node whose parent is not in the preview to a root instead of dropping it", () => {
    const wireframe = buildPageWireframe(
      previewOf([node("r1"), node("orphan", { parentId: "cut-off" })]),
      NO_LOCALES,
      "en",
    );
    expect(wireframe.roots.map((root) => root.id)).toEqual(["r1", "orphan"]);
  });
});

describe("buildPageWireframe dynamic repetition", () => {
  const findNode = (current: WireframeNode, id: string): WireframeNode | undefined => {
    if (current.id === id) return current;
    for (const child of current.children) {
      const hit = findNode(child, id);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };

  const repeatOfOne = (nodes: readonly PagePreviewNode[], id: string): number | undefined => {
    const wireframe = buildPageWireframe(previewOf(nodes), NO_LOCALES, "en");
    for (const root of wireframe.roots) {
      const hit = findNode(root, id);
      if (hit !== undefined) return hit.repeat;
    }
    return undefined;
  };

  it("repeats static non-list nodes once and lists always a couple of rows", () => {
    expect(repeatOfOne([node("n1", { name: "main" })], "n1")).toBe(1);
    expect(repeatOfOne([node("n1", { name: "ul" })], "n1")).toBe(2);
    expect(repeatOfOne([node("n1", { name: "h1" })], "n1")).toBe(1);
  });

  it("bounds dynamic repetition to two or three placeholder rows", () => {
    expect(repeatOfOne([node("n1", { name: "main", dynamic: true })], "n1")).toBe(2);
    expect(repeatOfOne([node("n1", { name: "ul", dynamic: true })], "n1")).toBe(3);
    expect(
      repeatOfOne(
        [
          node("n1", { name: "main", dynamic: true }),
          node("c1", { parentId: "n1", dynamic: true }),
          node("c2", { parentId: "n1", dynamic: true }),
          node("c3", { parentId: "n1", dynamic: true }),
        ],
        "n1",
      ),
    ).toBe(3);
  });

  it("treats a child of a dynamic branch as dynamic even when the flag is not repeated", () => {
    expect(repeatOfOne([node("n1", { dynamic: true }), node("c1", { parentId: "n1" })], "c1")).toBe(
      2,
    );
  });
});

describe("buildPageWireframe truncation", () => {
  it("passes the truncated flag through and counts the preview nodes", () => {
    const wireframe = buildPageWireframe(
      previewOf([node("n1"), node("n2", { parentId: "n1" })], true),
      NO_LOCALES,
      "en",
    );
    expect(wireframe.truncated).toBe(true);
    expect(wireframe.count).toBe(2);
  });

  it("returns no roots for an empty preview", () => {
    const wireframe = buildPageWireframe(previewOf([]), NO_LOCALES, "en");
    expect(wireframe.roots).toEqual([]);
    expect(wireframe.count).toBe(0);
    expect(wireframe.truncated).toBe(false);
  });
});
