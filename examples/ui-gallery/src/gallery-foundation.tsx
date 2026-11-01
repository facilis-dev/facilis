import { Section } from "./section.tsx";

const COLOR_ROLES = [
  "base-100",
  "base-200",
  "base-300",
  "base-content",
  "primary",
  "primary-content",
  "secondary",
  "neutral",
  "info",
  "success",
  "warning",
  "error",
  "accent",
  "focus",
] as const;

const TYPE_SCALE = [
  { name: "3xl", size: "var(--text-3xl)", usage: "metric value" },
  { name: "2xl", size: "var(--text-2xl)", usage: "page title" },
  { name: "xl", size: "var(--text-xl)", usage: "dialog / auth title" },
  { name: "lg", size: "var(--text-lg)", usage: "card title" },
  { name: "base", size: "var(--text-base)", usage: "body / control" },
  { name: "md", size: "var(--text-md)", usage: "label / table meta" },
  { name: "sm", size: "var(--text-sm)", usage: "hint / pagination" },
  { name: "xs", size: "var(--text-xs)", usage: "badge / eyebrow" },
] as const;

const SHAPES = [
  { name: "radius-selector", token: "var(--radius-selector)" },
  { name: "radius-field", token: "var(--radius-field)" },
  { name: "radius-box", token: "var(--radius-box)" },
  { name: "radius-pill", token: "var(--radius-pill)" },
] as const;

const DEPTHS = [
  { name: "shadow-sm", token: "var(--shadow-sm)" },
  { name: "shadow-md", token: "var(--shadow-md)" },
  { name: "shadow-lg", token: "var(--shadow-lg)" },
] as const;

export function FoundationSection() {
  return (
    <Section
      id="foundation"
      title="Foundation"
      description="The design layer is a complete token set per theme. Components name roles only, so rebranding means editing values here, never a component."
    >
      <div className="gallery-panel">
        <h3 className="gallery-panel__title">Colour roles</h3>
        <div className="gallery-swatches">
          {COLOR_ROLES.map((role) => (
            <span className="gallery-swatch" key={role}>
              <span
                className="gallery-swatch__chip"
                style={{ background: "var(--color-" + role + ")" }}
              />
              <span className="gallery-swatch__name">--color-{role}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="gallery-panel">
        <h3 className="gallery-panel__title">Type scale</h3>
        <div>
          {TYPE_SCALE.map((type) => (
            <div className="gallery-type-row" key={type.name}>
              <span className="gallery-type-row__sample" style={{ fontSize: type.size }}>
                The quick brown fox
              </span>
              <span className="gallery-type-row__meta">
                {type.name} · {type.usage}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="gallery-grid">
        <div className="gallery-panel">
          <h3 className="gallery-panel__title">Shape</h3>
          <div className="gallery-shape-row">
            {SHAPES.map((shape) => (
              <span className="gallery-shape" key={shape.name}>
                <span className="gallery-shape__box" style={{ borderRadius: shape.token }} />
                <span className="gallery-shape__label">{shape.name}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="gallery-panel">
          <h3 className="gallery-panel__title">Elevation</h3>
          <div className="gallery-shape-row">
            {DEPTHS.map((depth) => (
              <span className="gallery-shape" key={depth.name}>
                <span className="gallery-shape__box" style={{ boxShadow: depth.token }} />
                <span className="gallery-shape__label">{depth.name}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="gallery-panel">
          <h3 className="gallery-panel__title">Density</h3>
          <div className="gallery-stack">
            <div className="gallery-density" style={{ height: "var(--control-h)" }}>
              --control-h · 38px controls
            </div>
            <div className="gallery-density" style={{ height: "var(--row-h)" }}>
              --row-h · 44px table rows
            </div>
            <div className="gallery-density">
              --pad-card {12} · --pad-page {16}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
