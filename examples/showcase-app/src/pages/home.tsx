import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { CtaBand } from "../components/cta-band.tsx";
import { FeatureCard } from "../components/feature-card.tsx";
import { ProjectCard } from "../components/project-card.tsx";
import { SectionHeading } from "../components/section-heading.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { buttonClass } from "../components/ui/button.tsx";
import { FEATURES, PROJECTS, STATS } from "../lib/content.ts";
import { t } from "../lib/i18n.tsx";

/** The landing page: hero, selected work, services and the closing call to action. */
export function HomePage() {
  const featured = PROJECTS.slice(0, 3);
  const services = FEATURES.slice(0, 3);

  return (
    <>
      <section className="border-b border-border">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-14 px-5 pt-16 pb-20 lg:grid-cols-[1.1fr_0.9fr] lg:pt-24 lg:pb-24">
          <div className="flex flex-col items-start gap-7">
            <Badge variant="accent">{t("home.hero.eyebrow")}</Badge>
            <h1 className="font-serif text-5xl leading-[1.02] tracking-tight text-balance sm:text-6xl lg:text-7xl">
              {t("home.hero.title")}
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
              {t("home.hero.description")}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link className={buttonClass({ size: "lg" })} to="/showcase">
                {t("home.hero.primary")}
                <ArrowRight />
              </Link>
              <Link className={buttonClass({ variant: "outline", size: "lg" })} to="/contact">
                {t("home.hero.secondary")}
              </Link>
            </div>
            <dl className="flex flex-wrap gap-x-10 gap-y-5 border-t border-border pt-7">
              {STATS.map((stat) => (
                <div key={stat.labelKey} className="flex flex-col-reverse gap-1">
                  <dt className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
                    {t(stat.labelKey)}
                  </dt>
                  <dd className="font-serif text-3xl leading-none">{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="relative mx-auto w-full max-w-sm lg:max-w-none">
            <div
              aria-hidden="true"
              className="absolute -right-4 -bottom-4 h-full w-full rounded-2xl border border-border"
            />
            <div className="relative aspect-4/5 overflow-hidden rounded-2xl bg-primary text-primary-foreground">
              <div aria-hidden="true" className="bg-grid absolute inset-0 opacity-15" />
              <div className="relative flex h-full flex-col justify-between p-8">
                <p className="text-[10px] font-semibold tracking-[0.22em] uppercase opacity-60">
                  {t("home.hero.note")}
                </p>
                <p
                  aria-hidden="true"
                  className="font-serif text-8xl leading-none italic opacity-90"
                >
                  V.
                </p>
                <div aria-hidden="true" className="flex gap-2 self-end">
                  <span className="size-10 rounded-full bg-accent" />
                  <span className="size-10 rounded-full bg-secondary" />
                  <span className="size-10 rounded-full border border-primary-foreground/40" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-20">
        <SectionHeading
          eyebrow={t("home.work.eyebrow")}
          title={t("home.work.title")}
          description={t("home.work.description")}
          action={
            <Link className={buttonClass({ variant: "outline", size: "sm" })} to="/showcase">
              {t("home.work.all")}
              <ArrowRight />
            </Link>
          }
        />
        <div className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((project) => (
            <ProjectCard key={project.titleKey} project={project} />
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-secondary/30">
        <div className="mx-auto w-full max-w-6xl px-5 py-20">
          <SectionHeading
            eyebrow={t("home.features.eyebrow")}
            title={t("home.features.title")}
            description={t("home.features.description")}
            action={
              <Link className={buttonClass({ variant: "outline", size: "sm" })} to="/features">
                {t("home.features.all")}
                <ArrowRight />
              </Link>
            }
          />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((feature) => (
              <FeatureCard key={feature.titleKey} feature={feature} />
            ))}
          </div>
        </div>
      </section>

      <div className="pt-20">
        <CtaBand />
      </div>
    </>
  );
}
