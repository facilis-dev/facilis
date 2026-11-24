import { useLocation } from "react-router-dom";
import { docByRoute } from "../lib/docs.ts";
import { DocPage } from "./doc.tsx";
import { NotFoundPage } from "./not-found.tsx";

/**
 * The catch-all is the file-based routing escape hatch (issue #163): a content file added
 * after scaffolding is reachable at its file-derived route with no React edit, because
 * this page resolves any pathname against the content registry.
 *
 * It is deliberately path="*" and not path="/docs/*": the prerender gate matches declared
 * routes against route-table patterns (pathMatches), so a /docs/* splat would be marked
 * declared by every concrete /docs/... allowlist entry and fail the build as dynamic-path
 * (D-202 fail-closed). A bare "*" never matches a declared route — the showcase precedent.
 * Literal routes rank above the splat, so shipped pages keep their explicit entries.
 */
export function CatchAllPage() {
  const { pathname } = useLocation();
  if (docByRoute(pathname) !== undefined) return <DocPage />;
  return <NotFoundPage />;
}
