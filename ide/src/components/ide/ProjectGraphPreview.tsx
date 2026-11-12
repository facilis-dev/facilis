// The page inspector's schematic "semi-render": a small device frame that draws the analyzer's
// page structure as simplified UI blocks — bars, sidebar, sections, list rows, buttons, inputs,
// media, component cards and slots — instead of a tree of strings. It is a wireframe, never a
// rendering: labels are the JSX names, copy is the project's own t("key") text, and dynamic
// branches are marked and drawn with placeholder rows. Every node with a known source location
// opens that file at its line.

import { useMemo, type ReactNode } from "react";
import type { PagePreview } from "@facilis.dev/analyze";
import { t } from "@/i18n";
import {
  buildPageWireframe,
  type WireframeNode,
  type WireframeTag,
} from "@/facilis/graph-wireframe";

type Locales = Readonly<Record<string, Readonly<Record<string, string>>>>;
type OpenFileAt = (file: string, line: number) => void;

/** How each wireframe block is drawn: compact boxes, 9–10px text, no raw palette colours. */
const TAG_BOX: Readonly<Record<WireframeTag, string>> = {
  bar: "rounded-sm border border-border/50 bg-muted/60 px-1.5 py-1",
  nav: "w-[44%] max-w-[44%] rounded border border-border/60 bg-accent/25 p-1",
  main: "rounded border border-border/70 bg-background/60 p-1.5",
  section: "rounded border border-border/60 bg-card/40 p-1.5",
  list: "rounded-sm bg-muted/20 px-1 py-0.5",
  action:
    "inline-flex max-w-full items-center rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary",
  field: "flex items-center rounded border border-border/70 bg-background px-1 py-0.5",
  media: "flex h-7 items-center justify-center rounded bg-muted/70 px-1",
  component: "rounded border border-dashed border-border/80 bg-card px-1.5 py-1",
  slot: "rounded border border-dashed border-border/60 px-1.5 py-0.5",
  text: "px-0.5",
  other: "rounded border border-border/40 px-1.5 py-0.5",
};

/** A container draws its children inside its own box; a leaf draws them after the box. */
const CONTAINERS: ReadonlySet<WireframeTag> = new Set<WireframeTag>([
  "bar",
  "nav",
  "main",
  "section",
  "list",
  "component",
  "slot",
  "other",
]);

const BADGE = "shrink-0 rounded border px-0.5 text-[8px] leading-tight";

function DynamicBadge() {
  return (
    <span className={BADGE + " border-warning/40 text-warning"}>
      {t("projectGraph.preview.dynamic")}
    </span>
  );
}

function SlotBadge() {
  return (
    <span className={BADGE + " border-border/60 text-muted-foreground"}>
      {t("projectGraph.preview.slot")}
    </span>
  );
}

function MutedLabel({ label, badge }: { label: string; badge: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="min-w-0 truncate font-mono text-[8px] tracking-wide text-muted-foreground/80 uppercase">
        {label}
      </span>
      {badge}
    </span>
  );
}

/** The block's own content, before its children are laid out by the wrapper. */
function BlockBody({ node, label }: { node: WireframeNode; label: string }) {
  const badge = node.dynamic ? <DynamicBadge /> : null;
  switch (node.tag) {
    case "text": {
      // h1–h3 are the only text intrinsics the analyzer keeps as nodes; render them as headings.
      const heading = /^h[1-3]$/i.test(node.label);
      return (
        <span className="flex min-w-0 items-center gap-1">
          <span
            className={
              heading
                ? "min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground"
                : "min-w-0 flex-1 truncate text-[10px] text-foreground"
            }
          >
            {node.text ?? label}
          </span>
          {badge}
        </span>
      );
    }
    case "action":
      return (
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-[10px]">{node.text ?? label}</span>
          {badge}
        </span>
      );
    case "field":
      return (
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-[9px] text-muted-foreground">
            {node.text ?? label}
          </span>
          {badge}
        </span>
      );
    case "media":
      return (
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-center text-[8px] text-muted-foreground">
            {label}
          </span>
          {badge}
        </span>
      );
    case "list": {
      // A list always shows rows: one for a known branch, a bounded few for a dynamic one.
      const width = ["w-4/5", "w-3/5", "w-2/3"];
      return (
        <>
          <MutedLabel label={label} badge={badge} />
          {width.slice(0, node.repeat).map((row, index) => (
            <span
              key={index}
              className={"mt-0.5 block h-1 rounded-sm bg-muted-foreground/25 " + row}
            />
          ))}
        </>
      );
    }
    case "component": {
      const childComponents = node.children.filter((child) => child.tag === "component").length;
      const hint =
        node.definitionFile !== null
          ? node.definitionFile
          : childComponents > 0
            ? t("projectGraph.preview.componentCount", { count: childComponents })
            : null;
      return (
        <>
          <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-foreground">
              {label}
            </span>
            {badge}
          </span>
          {node.text !== null && (
            <span className="mt-0.5 block truncate text-[9px] leading-tight text-foreground/80">
              {node.text}
            </span>
          )}
          {hint !== null && (
            <span className="mt-0.5 block truncate font-mono text-[8px] text-muted-foreground">
              {hint}
            </span>
          )}
        </>
      );
    }
    case "slot":
      return (
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-[9px] text-muted-foreground">{label}</span>
          <SlotBadge />
          {badge}
        </span>
      );
    default:
      return <MutedLabel label={label} badge={badge} />;
  }
}

function NodeBlock({ node, onOpenFileAt }: { node: WireframeNode; onOpenFileAt: OpenFileAt }) {
  const label = node.label.trim() === "" ? t("projectGraph.unknown") : node.label;
  const file = node.file;
  const line = node.line;
  const openable = file !== null && line !== null;
  const container = CONTAINERS.has(node.tag);
  const children =
    node.children.length === 0 ? null : (
      <div className="mt-0.5 space-y-0.5 border-l border-border/40 pl-1">
        {node.children.map((child) => (
          <NodeBlock key={child.id} node={child} onOpenFileAt={onOpenFileAt} />
        ))}
      </div>
    );
  const body = <BlockBody node={node} label={label} />;
  const boxClass = TAG_BOX[node.tag] + " min-w-0 overflow-hidden text-[9px] leading-tight";
  // Containers fill the inspector width; nav keeps its sidebar width, leaves their content.
  const fill = container && node.tag !== "nav" ? " w-full" : "";
  const opener = openable ? (
    <button
      type="button"
      title={t("projectGraph.preview.open", { file })}
      className={
        "block min-w-0 w-full cursor-pointer text-left hover:bg-accent/40" +
        (container ? "" : boxClass + fill)
      }
      onClick={() => onOpenFileAt(file, line)}
    >
      {body}
    </button>
  ) : null;
  // A container keeps one box around its own body *and* its children, so the children's
  // open-buttons are siblings of the container's, never nested (a button inside a button is
  // invalid and breaks keyboard/AT semantics).
  const inner = container ? (
    <div className={boxClass + fill}>
      {opener ?? body}
      {children}
    </div>
  ) : (
    (opener ?? <div className={boxClass + fill}>{body}</div>)
  );
  return (
    <div className="min-w-0">
      {node.dynamic ? (
        <div className="rounded border border-dashed border-warning/50 p-0.5">{inner}</div>
      ) : (
        inner
      )}
    </div>
  );
}

function DeviceHeader() {
  return (
    <div className="border-b border-border/60 bg-muted/30 px-2 py-1">
      <div className="flex min-w-0 items-center gap-1">
        <span aria-hidden className="flex shrink-0 gap-0.5">
          <span className="size-1 rounded-full bg-muted-foreground/40" />
          <span className="size-1 rounded-full bg-muted-foreground/40" />
          <span className="size-1 rounded-full bg-muted-foreground/40" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-foreground">
          {t("projectGraph.preview.title")}
        </span>
        <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-1 text-[8px] leading-tight text-warning">
          {t("projectGraph.preview.fakeData")}
        </span>
      </div>
      <p className="mt-0.5 line-clamp-2 text-[9px] leading-tight text-muted-foreground">
        {t("projectGraph.preview.staticNote")}
      </p>
    </div>
  );
}

export function ProjectGraphPreview({
  preview,
  locales,
  defaultLocale,
  onOpenFileAt,
}: {
  preview: PagePreview;
  locales: Locales;
  defaultLocale: string | null;
  onOpenFileAt: OpenFileAt;
}) {
  const wireframe = useMemo(
    () => buildPageWireframe(preview, locales, defaultLocale),
    [preview, locales, defaultLocale],
  );
  return (
    <div
      data-testid="project-graph-preview"
      className="min-w-0 overflow-hidden rounded-md border border-border bg-background/40"
    >
      <DeviceHeader />
      <div className="min-w-0 space-y-1 overflow-hidden p-1.5">
        {wireframe.roots.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">{t("projectGraph.preview.empty")}</p>
        ) : (
          wireframe.roots.map((root) => (
            <NodeBlock key={root.id} node={root} onOpenFileAt={onOpenFileAt} />
          ))
        )}
        {wireframe.truncated && (
          <p className="rounded border border-warning/40 bg-warning/5 px-1.5 py-1 text-[9px] text-warning">
            {t("projectGraph.preview.truncated")}
          </p>
        )}
      </div>
    </div>
  );
}
