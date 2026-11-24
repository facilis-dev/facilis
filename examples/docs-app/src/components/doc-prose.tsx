import type { MouseEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

/**
 * The rendered-content wrapper. Markdown arrives as an HTML string, MDX as a component
 * tree; both render inside .doc-prose (styles.css) so authored content shares one style.
 *
 * Root-relative links in content must navigate through the router: under the IDE preview
 * the app lives at /preview/<port>/, and a plain <a href="/docs/..."> would leave that
 * base (D-202 gotcha 7). Click delegation keeps the authored hrefs real for SEO and the
 * prerendered HTML (the dev middleware rewrites those), while client navigation stays
 * inside the router basename.
 */
export function DocProse({ html, children }: { html?: string; children?: ReactNode }) {
  const navigate = useNavigate();
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a");
    const href = anchor?.getAttribute("href") ?? "";
    if (!href.startsWith("/")) return;
    event.preventDefault();
    void navigate(href);
  };
  if (html !== undefined) {
    return (
      <div className="doc-prose" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
    );
  }
  return (
    <div className="doc-prose" onClick={onClick}>
      {children}
    </div>
  );
}
