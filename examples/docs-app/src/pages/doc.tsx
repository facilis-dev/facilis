import { Link, useLocation } from "react-router-dom";
import { DocPager } from "../components/doc-pager.tsx";
import { DocProse } from "../components/doc-prose.tsx";
import { DocToc } from "../components/doc-toc.tsx";
import { MDX_COMPONENTS } from "../components/mdx-components.tsx";
import { buttonClass } from "../components/ui/button.tsx";
import { docByRoute, type DocEntry } from "../lib/docs.ts";
import { t } from "../lib/i18n.tsx";
import { extractHeadings, renderMarkdown } from "../lib/markdown.ts";
import { compileMdx } from "../lib/mdx.ts";

/**
 * One component renders every content page: the route (file-derived, see lib/docs.ts)
 * selects the entry, so the explicit route table in app.tsx and the /docs/* catch-all
 * share this page. Markdown renders to HTML; MDX compiles to a component at render time.
 */
export function DocPage() {
  const { pathname } = useLocation();
  const doc = docByRoute(pathname);
  if (doc === undefined) return <MissingDoc />;
  return <DocArticle doc={doc} />;
}

function DocArticle({ doc }: { doc: DocEntry }) {
  const headings = extractHeadings(doc.body);
  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_14rem]">
      <article className="min-w-0">
        {/* React 19 document metadata (D-202 SEO): each page hoists its own title/meta. */}
        <title>{doc.title + " — " + t("app.title")}</title>
        <meta name="description" content={doc.description ?? t("meta.docs.description")} />
        <header className="mb-8 border-b border-border pb-6">
          <h1 className="font-serif text-4xl leading-tight tracking-tight text-balance">
            {doc.title}
          </h1>
          {doc.description !== null ? (
            <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{doc.description}</p>
          ) : null}
        </header>
        {doc.format === "mdx" ? (
          <MdxBody body={doc.body} />
        ) : (
          <DocProse html={renderMarkdown(doc.body)} />
        )}
        <DocPager route={doc.route} />
      </article>
      <aside className="hidden xl:block">
        <div className="sticky top-24">
          <DocToc entries={headings} />
        </div>
      </aside>
    </div>
  );
}

function MdxBody({ body }: { body: string }) {
  const Content = compileMdx(body);
  return (
    <DocProse>
      <Content components={MDX_COMPONENTS} />
    </DocProse>
  );
}

/** A /docs/* path with no content file: fail soft with a way back, never a blank page. */
function MissingDoc() {
  return (
    <div className="flex flex-col items-start gap-4 py-10">
      <title>{t("meta.notfound.title")}</title>
      <h1 className="font-serif text-3xl tracking-tight">{t("doc.missing.title")}</h1>
      <p className="max-w-lg text-muted-foreground">{t("doc.missing.body")}</p>
      <Link className={buttonClass({ variant: "outline" })} to="/docs">
        {t("doc.missing.back")}
      </Link>
    </div>
  );
}
