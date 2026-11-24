import { ArrowRight, FileText, GitBranch, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { buttonClass } from "../components/ui/button.tsx";
import { docTree } from "../lib/docs.ts";
import { t } from "../lib/i18n.tsx";

const FEATURES = [
  {
    icon: FileText,
    titleKey: "home.features.routing.title",
    bodyKey: "home.features.routing.body",
  },
  {
    icon: GitBranch,
    titleKey: "home.features.frontmatter.title",
    bodyKey: "home.features.frontmatter.body",
  },
  { icon: Zap, titleKey: "home.features.prerender.title", bodyKey: "home.features.prerender.body" },
] as const;

/** The docs portal: hero, the section cards derived from the content tree, and the pitch. */
export function HomePage() {
  const tree = docTree();
  return (
    <>
      <title>{t("meta.home.title")}</title>
      <meta name="description" content={t("meta.home.description")} />
      <section className="border-b border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-6 py-16 lg:py-20">
          <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
            {t("home.hero.eyebrow")}
          </p>
          <h1 className="font-serif text-5xl leading-[1.05] tracking-tight text-balance sm:text-6xl">
            {t("home.hero.title")}
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
            {t("home.hero.description")}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link className={buttonClass({ size: "lg" })} to="/docs/getting-started">
              {t("home.hero.primary")}
              <ArrowRight />
            </Link>
            <Link className={buttonClass({ variant: "outline", size: "lg" })} to="/docs">
              {t("home.hero.secondary")}
            </Link>
          </div>
        </div>
      </section>

      <section className="py-14">
        <h2 className="font-serif text-2xl tracking-tight">{t("home.sections.title")}</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {tree.sections.map((section) => {
            const target = section.index ?? section.pages[0] ?? section.sections[0]?.index;
            if (target === undefined || target === null) return null;
            const count = section.pages.length + (section.index !== null ? 1 : 0);
            return (
              <Link
                key={section.key}
                to={target.route}
                className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-6 transition-colors hover:border-accent/50"
              >
                <span className="text-lg font-semibold group-hover:text-accent">
                  {section.label}
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">
                  {target.description ?? t("home.section.fallback")}
                </span>
                <span className="mt-auto pt-2 text-xs text-muted-foreground">
                  {t("home.section.count", { count })}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="border-t border-border py-14">
        <h2 className="font-serif text-2xl tracking-tight">{t("home.features.title")}</h2>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.titleKey} className="flex flex-col gap-3">
              <feature.icon aria-hidden="true" className="size-5 text-accent" />
              <h3 className="text-base font-semibold">{t(feature.titleKey)}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{t(feature.bodyKey)}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
