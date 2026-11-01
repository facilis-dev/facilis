import type { ReactNode } from "react";

export type SectionProps = {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
};

/** Gallery section shell: one heading, one description, then the demo panels. */
export function Section({ id, title, description, children }: SectionProps) {
  return (
    <section className="gallery-section" aria-labelledby={id + "-title"}>
      <header className="gallery-section__header">
        <h2 className="gallery-section__title" id={id + "-title"}>
          {title}
        </h2>
        <p className="gallery-section__description">{description}</p>
      </header>
      {children}
    </section>
  );
}
