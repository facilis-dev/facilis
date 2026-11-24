import { Route, Routes } from "react-router-dom";
import { SiteLayout } from "./layouts/site-layout.tsx";
import { useLocale } from "./lib/i18n.tsx";
import { ContactPage } from "./pages/contact.tsx";
import { FeaturesPage } from "./pages/features.tsx";
import { HomePage } from "./pages/home.tsx";
import { NotFoundPage } from "./pages/not-found.tsx";
import { ShowcasePage } from "./pages/showcase.tsx";

/**
 * The one explicit route table. Every page resolves to a file under src/pages; the IDE's
 * project graph reads this file to build the navigation map, so routes stay declarative.
 */
export function App() {
  // Subscribing once at the root re-renders every page whenever the locale changes. Each page
  // hoists its own <title> (React 19 document metadata, D-202 SEO), so there is no imperative
  // document.title here to fight the prerendered head.
  useLocale();

  return (
    <Routes>
      <Route element={<SiteLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/showcase" element={<ShowcasePage />} />
        <Route path="/contact" element={<ContactPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
