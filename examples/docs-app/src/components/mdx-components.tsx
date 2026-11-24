import { Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "../lib/i18n.tsx";
import { slugHeading } from "../lib/markdown.ts";
import { mdxPlainText, type MdxComponents } from "../lib/mdx.ts";
import { cn } from "../lib/utils.ts";

/**
 * The component map MDX content renders with (issue #163). Headings carry the same slug
 * ids the TOC extracts from the raw source, so anchors work in .mdx exactly as in .md.
 * Callout is the template's one authored component: semantic tokens only, label via t().
 */

function MdxHeading({ level, children }: { level: 2 | 3; children?: ReactNode }) {
  const id = slugHeading(mdxPlainText(children));
  if (level === 2) return <h2 id={id}>{children}</h2>;
  return <h3 id={id}>{children}</h3>;
}

function Callout({ type, children }: { type?: unknown; children?: ReactNode }) {
  const warning = type === "warning";
  return (
    <aside
      className={cn(
        "my-6 flex gap-3 rounded-lg border p-4",
        warning ? "border-destructive/40 bg-destructive/5" : "border-accent/40 bg-accent/5",
      )}
    >
      {warning ? (
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      ) : (
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
      )}
      <div className="min-w-0 text-sm">
        <p className={cn("mb-1 font-semibold", warning ? "text-destructive" : "text-accent")}>
          {warning ? t("callout.warning") : t("callout.info")}
        </p>
        <div className="text-foreground/90">{children}</div>
      </div>
    </aside>
  );
}

export const MDX_COMPONENTS: MdxComponents = {
  h2: ({ children }) => <MdxHeading level={2}>{children}</MdxHeading>,
  h3: ({ children }) => <MdxHeading level={3}>{children}</MdxHeading>,
  Callout,
};
