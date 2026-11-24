import { Route, Routes } from "react-router-dom";
import { DocsLayout } from "./layouts/docs-layout.tsx";
import { useLocale } from "./lib/i18n.tsx";
import { CatchAllPage } from "./pages/catch-all.tsx";
import { DocPage } from "./pages/doc.tsx";
import { HomePage } from "./pages/home.tsx";

/**
 * The one explicit route table. Every page resolves to a file under src/pages; the IDE's
 * project graph reads this file to build the navigation map, so routes stay declarative.
 *
 * Docs routing is file-derived (lib/docs.ts), but the shipped content pages are ALSO
 * listed here as literal entries: the prerender eligibility gate reads this table
 * statically (D-092/D-202), and only a literal, param-free entry can be declared in
 * vite.config.ts. The bare "*" catch-all serves any content file added later without a
 * React edit (issue #163, see pages/catch-all.tsx); to prerender a new page, add its
 * literal route here and to the allowlist. DocPage selects content by pathname, so the
 * literal entries and the catch-all share one component.
 */
export function App() {
  // Subscribing once at the root re-renders every page whenever the locale changes. Each page
  // hoists its own <title> (React 19 document metadata, D-202 SEO), so there is no imperative
  // document.title here to fight the prerendered head.
  useLocale();

  return (
    <Routes>
      <Route element={<DocsLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/docs" element={<DocPage />} />
        <Route path="/docs/getting-started" element={<DocPage />} />
        <Route path="/docs/guides" element={<DocPage />} />
        <Route path="/docs/guides/content-pipeline" element={<DocPage />} />
        <Route path="/docs/guides/navigation" element={<DocPage />} />
        <Route path="/docs/reference/frontmatter" element={<DocPage />} />
        <Route path="*" element={<CatchAllPage />} />
      </Route>
    </Routes>
  );
}
