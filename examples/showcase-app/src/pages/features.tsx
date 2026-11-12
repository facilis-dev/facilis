import { CtaBand } from "../components/cta-band.tsx";
import { FeatureCard } from "../components/feature-card.tsx";
import { PageHero } from "../components/page-hero.tsx";
import { SectionHeading } from "../components/section-heading.tsx";
import { FEATURES, PROCESS_STEPS } from "../lib/content.ts";
import { t } from "../lib/i18n.tsx";

export function FeaturesPage() {
  return (
    <>
      <PageHero
        eyebrow={t("features.hero.eyebrow")}
        title={t("features.hero.title")}
        description={t("features.hero.description")}
      />
      <section className="mx-auto w-full max-w-6xl px-5 py-20">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.titleKey} feature={feature} />
          ))}
        </div>
      </section>
      <section className="border-y border-border bg-secondary/30">
        <div className="mx-auto w-full max-w-6xl px-5 py-20">
          <SectionHeading
            eyebrow={t("features.process.eyebrow")}
            title={t("features.process.title")}
            description={t("features.process.description")}
          />
          <ol className="mt-10 grid gap-10 md:grid-cols-3">
            {PROCESS_STEPS.map((step, index) => (
              <li key={step.titleKey} className="flex flex-col gap-3 border-t-2 border-accent pt-5">
                <span className="font-serif text-sm tracking-wide text-accent">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="font-serif text-2xl tracking-tight">{t(step.titleKey)}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{t(step.bodyKey)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <div className="pt-20">
        <CtaBand />
      </div>
    </>
  );
}
