import { describe, expect, it } from "vitest";

import { analyzeProject } from "../analyze.ts";
import { createOxcParser } from "../node.ts";

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
