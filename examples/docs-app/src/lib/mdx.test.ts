import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { compileMdx, mdxPlainText } from "./mdx.ts";

describe("compileMdx", () => {
  it("compiles MDX to a component that renders markdown and JSX", () => {
    const Content = compileMdx("## Heading\n\nHello **world**.");
    const html = renderToStaticMarkup(createElement(Content));
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<strong>world</strong>");
  });

  it("renders supplied components with their props", () => {
    const Content = compileMdx('<Callout type="warning">Careful.</Callout>');
    const html = renderToStaticMarkup(
      createElement(Content, {
        components: {
          Callout: ({ type, children }: { type?: unknown; children?: unknown }) =>
            createElement("aside", { "data-type": String(type) }, children as string),
        },
      }),
    );
    expect(html).toContain('data-type="warning"');
    expect(html).toContain("Careful.");
  });

  it("caches one component per source text", () => {
    const source = "Cached page.";
    expect(compileMdx(source)).toBe(compileMdx(source));
  });
});

describe("mdxPlainText", () => {
  it("flattens strings, numbers, arrays and elements", () => {
    expect(mdxPlainText("Why ")).toBe("Why ");
    expect(mdxPlainText(2)).toBe("2");
    expect(mdxPlainText(["MDX", "?"])).toBe("MDX?");
    expect(mdxPlainText(createElement("em", null, "MDX"))).toBe("MDX");
    expect(mdxPlainText(null)).toBe("");
    expect(mdxPlainText(true)).toBe("");
  });
});
