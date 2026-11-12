import { describe, expect, it } from "vitest";

import { analyzeProject } from "../analyze.ts";
import { createOxcParser } from "../node.ts";
import type { PagePreviewNode } from "../types-graph.ts";

const FILES: Record<string, string> = {
  "src/app.tsx": `
import { Route, Routes } from "react-router-dom";
import { Shell } from "./layouts/shell.tsx";
import { AboutPage } from "./pages/about.tsx";
import { HomePage } from "./pages/home.tsx";
export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
      </Route>
    </Routes>
  );
}
`,
  "src/layouts/shell.tsx": `
import { Outlet } from "react-router-dom";
export function Shell() {
  return (
    <div>
      <header>Brand</header>
      <main><Outlet /></main>
    </div>
  );
}
`,
  "src/pages/home.tsx": `
import { Link } from "react-router-dom";
import { Header } from "../components/header.tsx";
export function HomePage() {
  return (
    <div>
      <Header />
      <h1>Home</h1>
      <Link to="/about">About</Link>
    </div>
  );
}
`,
  "src/pages/about.tsx": `
import { Link } from "react-router-dom";
export function AboutPage() {
  return (
    <section>
      <Link to="/">Home</Link>
    </section>
  );
}
`,
  "src/components/header.tsx": `
export function Header() {
  return <header><span>Brand</span></header>;
}
`,
};

function analysisOf() {
  return analyzeProject({
    files: new Map(Object.entries(FILES)),
    parser: createOxcParser(),
  });
}

describe("static screens", () => {
  it("keeps every page, including pages without API calls, with route paths", () => {
    const analysis = analysisOf();
    const pages = analysis.graph.nodes.filter((node) => node.kind === "page");
    expect(pages.map((node) => node.id)).toEqual([
      "page:src/pages/about.tsx",
      "page:src/pages/home.tsx",
    ]);
    const home = pages.find((node) => node.id === "page:src/pages/home.tsx");
    expect(home?.data.kind === "page" ? home.data.routePaths : undefined).toEqual(["/"]);
    expect(home?.data.kind === "page" ? home.data.callCount : undefined).toBe(0);
  });

  it("composes the route layout around the page through Outlet", () => {
    const analysis = analysisOf();
    const home = analysis.graph.nodes.find((node) => node.id === "page:src/pages/home.tsx");
    const nodes = home?.data.kind === "page" ? (home.data.preview?.nodes ?? []) : [];
    const names = nodes.map((node) => node.name);
    expect(names).toContain("Shell");
    expect(names).toContain("HomePage");
    expect(names).toContain("Header");
    expect(names).toContain("h1");
    const shell = nodes.find((node) => node.name === "Shell");
    const homePage = nodes.find((node) => node.name === "HomePage");
    expect(homePage?.parentId === shell?.id || homePage?.parentId !== null).toBe(true);
    expect(nodes.some((node) => node.name === "Outlet")).toBe(false);
  });

  it("adds explicit page links only", () => {
    const analysis = analysisOf();
    const links = analysis.graph.edges
      .filter((edge) => edge.kind === "page-link")
      .map((edge) => ({ source: edge.source, target: edge.target, label: edge.label }))
      .toSorted((left, right) => left.source.localeCompare(right.source));
    expect(links).toEqual([
      { source: "page:src/pages/about.tsx", target: "page:src/pages/home.tsx", label: "/" },
      { source: "page:src/pages/home.tsx", target: "page:src/pages/about.tsx", label: "/about" },
    ]);
  });
});

const TEXT_FILES: Record<string, string> = {
  "src/app.tsx": `
import { Route, Routes } from "react-router-dom";
import { TextPage } from "./pages/text.tsx";
export function App() {
  return (
    <Routes>
      <Route path="/text" element={<TextPage />} />
    </Routes>
  );
}
`,
  "src/components/card.tsx": `
export function Card() {
  return (
    <section>
      <header>Inner brand</header>
    </section>
  );
}
`,
  "src/pages/text.tsx": `
import { Card } from "../components/card.tsx";
export function TextPage() {
  return (
    <main>
      <h1>
        Hello     world
      </h1>
      <h2>{t("page.title")}</h2>
      <h3>{\`Template   text\`}</h3>
      <section>{i18n.t("member.key")}Outer<Card /></section>
      <Card>card label</Card>
      <nav />
      <aside>{""}</aside>
      <footer>   </footer>
      <section>{loading ? <header>Loading</header> : <header>Ready</header>}</section>
      <article>{items.map((item) => <section key={item.id}>{item.title}</section>)}</article>
      <header>{t(name)}</header>
    </main>
  );
}
`,
};

function textPreviewNodes(): readonly PagePreviewNode[] {
  const analysis = analyzeProject({
    files: new Map(Object.entries(TEXT_FILES)),
    parser: createOxcParser(),
  });
  const page = analysis.graph.nodes.find((node) => node.id === "page:src/pages/text.tsx");
  if (page === undefined || page.data.kind !== "page") throw new Error("missing text page");
  return page.data.preview?.nodes ?? [];
}

function nodeNamed(nodes: readonly PagePreviewNode[], name: string): PagePreviewNode {
  const node = nodes.find((candidate) => candidate.name === name);
  if (node === undefined) throw new Error("missing preview node: " + name);
  return node;
}

describe("page preview text", () => {
  it("captures direct literal text on an intrinsic and on a component", () => {
    const nodes = textPreviewNodes();
    expect(nodeNamed(nodes, "h1").text).toBe("Hello world");
    const card = nodes.find((node) => node.name === "Card" && node.text === "card label");
    expect(card?.text).toBe("card label");
    expect("tKey" in nodeNamed(nodes, "h1")).toBe(false);
  });

  it("turns t() keys into tKey and keeps literal text as the fallback", () => {
    const nodes = textPreviewNodes();
    const title = nodeNamed(nodes, "h2");
    expect(title.tKey).toBe("page.title");
    expect("text" in title).toBe(false);
    // The member form i18n.t() is a translation too; the literal text stays as the fallback.
    const section = nodes.find((node) => node.tKey === "member.key");
    expect(section?.name).toBe("section");
    expect(section?.text).toBe("Outer");
    // A template literal without substitutions is static text.
    expect(nodeNamed(nodes, "h3").text).toBe("Template   text");
  });

  it("omits the fields when an element has no readable direct text", () => {
    const nodes = textPreviewNodes();
    const nav = nodeNamed(nodes, "nav");
    expect("text" in nav).toBe(false);
    expect("tKey" in nav).toBe(false);
    // Empty JSX text and empty strings are never emitted as labels.
    expect("text" in nodeNamed(nodes, "aside")).toBe(false);
    expect("text" in nodeNamed(nodes, "footer")).toBe(false);
    // A dynamic key is not guessed: {t(name)} stays unknown.
    const dynamicKey = nodes.filter((node) => node.name === "header" && node.text === undefined);
    expect(dynamicKey).toHaveLength(1);
    expect("tKey" in nodeNamed(nodes, "main")).toBe(false);
  });

  it("does not leak a nested component's text into its parent node", () => {
    const nodes = textPreviewNodes();
    const outer = nodes.find((node) => node.tKey === "member.key");
    expect(outer?.text).toBe("Outer");
    const inner = nodes.filter((node) => node.text === "Inner brand");
    expect(inner.map((node) => node.name)).toEqual(["header", "header"]);
    expect(inner.every((node) => node.parentId !== outer?.id)).toBe(true);
  });

  it("keeps dynamic branches dynamic without inventing their text", () => {
    const nodes = textPreviewNodes();
    const loading = nodes.find((node) => node.text === "Loading");
    const ready = nodes.find((node) => node.text === "Ready");
    expect(loading?.name).toBe("header");
    expect(loading?.dynamic).toBe(true);
    expect(ready?.dynamic).toBe(true);
    const mapped = nodes.filter((node) => node.name === "section" && node.dynamic);
    expect(mapped).toHaveLength(1);
    expect("text" in (mapped[0] ?? {})).toBe(false);
  });
});
