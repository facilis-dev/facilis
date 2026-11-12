import type { Project, ProjectTone } from "../lib/content.ts";
import { t } from "../lib/i18n.tsx";
import { cn } from "../lib/utils.ts";

const TONES: Record<ProjectTone, { shell: string; shape: string }> = {
  ember: { shell: "bg-primary text-primary-foreground", shape: "bg-accent/60" },
  ink: { shell: "bg-secondary text-secondary-foreground", shape: "bg-primary/15" },
  paper: { shell: "bg-accent text-accent-foreground", shape: "bg-primary-foreground/25" },
};

/** One work card: a token-only abstract cover plus the project title and discipline. */
export function ProjectCard({ project }: { project: Project }) {
  const tone = TONES[project.tone];
  const title = t(project.titleKey);

  return (
    <article className="flex flex-col gap-4">
      <div
        className={cn(
          "relative aspect-4/3 overflow-hidden rounded-2xl border border-border/70",
          tone.shell,
        )}
      >
        <span
          aria-hidden="true"
          className={cn("absolute -bottom-12 -left-10 size-48 rounded-full", tone.shape)}
        />
        <span
          aria-hidden="true"
          className="absolute top-5 right-5 size-14 rounded-full border border-current opacity-30"
        />
        <span
          aria-hidden="true"
          className="absolute bottom-3 left-6 font-serif text-8xl leading-none opacity-90 select-none"
        >
          {title.slice(0, 1)}
        </span>
        <span className="absolute top-5 left-5 text-[10px] font-semibold tracking-[0.2em] uppercase opacity-70">
          {project.year}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="font-serif text-xl tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground">{t(project.categoryKey)}</p>
      </div>
    </article>
  );
}
