import { CtaBand } from "../components/cta-band.tsx";
import { PageHero } from "../components/page-hero.tsx";
import { ProjectCard } from "../components/project-card.tsx";
import { PROJECTS } from "../lib/content.ts";
import { t } from "../lib/i18n.tsx";

export function ShowcasePage() {
  return (
    <>
      <PageHero
        eyebrow={t("showcase.hero.eyebrow")}
        title={t("showcase.hero.title")}
        description={t("showcase.hero.description")}
      />
      <section className="mx-auto w-full max-w-6xl px-5 py-20">
        <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          {t("showcase.count", { count: PROJECTS.length })}
        </p>
        <div className="mt-8 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {PROJECTS.map((project) => (
            <ProjectCard key={project.titleKey} project={project} />
          ))}
        </div>
      </section>
      <CtaBand />
    </>
  );
}
