// The page miniature: a page shaped by its kind, drawn as a wireframe with no labels (D-176,
// D-178).
//
// Two sizes share the model: the page card in the graph draws it under the card title, and the
// inspector draws the same sketch larger in place of the old labelled component tree. Both are
// decorative — the card title and the inspector section name carry the meaning — so every shape
// is aria-hidden and the drawing never takes a click: the card itself opens the details.
//
// The drawing follows the page kind the model proves (D-178): an app page gets the template's
// rail/header/content shell, an auth page the split brand panel beside a centred card, and a page
// with no shell gets one centred column. Only the app shell's blocks grow to fill the frame; the
// card and the bare page keep the natural proportion of their content.

import { useMemo, type ReactNode } from "react";
import type { PagePreview } from "@facilis.dev/analyze";
import { cn } from "@/lib/utils";
import {
  buildPageSketch,
  type PageSketch,
  type SketchBlock,
  type SketchBlockKind,
} from "@/facilis/graph-page-sketch";

const FRAME = "flex overflow-hidden rounded border border-border/70 bg-background/50";

// App shell: the two-pane page the template's AppLayout paints.
const RAIL = "flex w-[26%] shrink-0 flex-col gap-1 border-r border-border/60 bg-muted/25 p-1.5";
const RAIL_LOGO = "aspect-square w-[36%] rounded-sm bg-primary/45";
const RAIL_ITEM = "h-1 rounded-full bg-muted-foreground/25";
const RAIL_ITEM_FAINT = "h-1 rounded-full bg-muted-foreground/20";
const RAIL_AVATAR = "mt-auto aspect-square w-[32%] rounded-full bg-muted-foreground/25";

const TOP_BAR =
  "flex h-[17%] shrink-0 items-center justify-end gap-1 border-b border-border/60 bg-muted/20 px-1.5";
const TOP_BAR_LABEL = "h-[3px] w-[18%] rounded-full bg-muted-foreground/25";
const TOP_BAR_DOT = "size-1 rounded-full bg-muted-foreground/25";

const CONTENT = "flex min-w-0 flex-1 flex-col gap-1 p-1.5";

// Auth screen: the split auth layout — brand panel beside a centred card.
// The real auth layout is an even split: a card-coloured brand panel beside the muted stage.
const AUTH_BRAND = "flex w-1/2 shrink-0 flex-col gap-1.5 border-r border-border/60 bg-card p-2";
const AUTH_BRAND_LOGO = "flex items-center gap-1";
const AUTH_BRAND_MARK = "size-3 rounded-sm bg-primary/45";
const AUTH_BRAND_NAME = "h-[3px] w-1/2 rounded-full bg-muted-foreground/30";
const AUTH_BRAND_BODY = "flex flex-1 flex-col justify-center gap-1.5";
const AUTH_BRAND_GROUP = "flex flex-col gap-1";
const AUTH_BRAND_LINE = "h-[3px] rounded-full bg-muted-foreground/25";
const AUTH_BRAND_POINT = "flex items-center gap-1";
const AUTH_BRAND_DOT = "size-[3px] rounded-full bg-muted-foreground/30";
const AUTH_BRAND_POINT_LINE = "h-[2px] flex-1 rounded-full bg-muted-foreground/15";
const AUTH_STAGE = "flex min-w-0 flex-1 items-center justify-center bg-muted/25 p-2";
const AUTH_CARD =
  "flex w-[72%] flex-col gap-1 rounded-sm border border-border/70 bg-card p-1.5 shadow-sm";

// Bare page: no shell, so the content sits in one centred column.
const BARE = "flex flex-1 items-center justify-center p-2";
const BARE_COLUMN = "flex w-[64%] flex-col gap-1.5";
const STACK = "flex flex-col gap-1";

/**
 * The app content area is taller than a couple of regions need. Growing every block to fill it
 * made a one-region page read as a single giant box, so the leftover height stays empty page (the
 * spacer below) — blocks keep their natural proportion instead. The auth card and the bare page
 * are not grown: their frame is their content.
 */
const CONTENT_WEIGHT = 6;

/** Blocks carry a small, fixed vocabulary of shapes: no text, nothing to read at card size. */
const BLOCK_BOX: Readonly<Record<SketchBlockKind, string>> = {
  action: "flex items-center justify-start px-1",
  board: "flex flex-col justify-center rounded-sm border border-border/60 bg-card/70 p-1",
  branch:
    "flex items-center justify-center rounded-sm border border-dashed border-warning/50 bg-warning/5",
  form: "flex flex-col justify-center gap-1 rounded-sm border border-border/60 bg-card/70 px-1",
  heading: "flex flex-col justify-center gap-1 px-0.5",
  list: "flex flex-col gap-0.5 rounded-sm border border-border/60 bg-card/70 p-1",
  media: "flex items-center justify-center rounded-sm border border-border/50 bg-muted/60",
  text: "flex flex-col justify-center gap-0.5 px-0.5",
};

const LINE_FULL = "block h-[3px] w-full rounded-full bg-muted-foreground/20";
const LINE_SHORT = "block h-[3px] w-2/3 rounded-full bg-muted-foreground/20";
const LINE_FAINT = "block h-[3px] w-1/2 rounded-full bg-muted-foreground/15";
const INPUT = "h-1.5 rounded-sm border border-border/70 bg-muted/40";
const PILL = "h-1.5 w-1/3 rounded-full bg-primary/30";
const PILL_WIDE = "h-1.5 w-full rounded-full bg-primary/30";
const MEDIA_DOT = "size-3 rounded-full border border-border/70 bg-background/60";
const BRANCH_LINE = "block h-[3px] rounded-full bg-warning/30";
const BRANCH_LINE_FAINT = "block h-[3px] rounded-full bg-warning/20";
const HEADING_TITLE = "block h-[4px] w-2/3 rounded-full bg-muted-foreground/35";
const HEADING_SUBTITLE = "block h-[2px] w-1/2 rounded-full bg-muted-foreground/15";

/**
 * A form draws the rows the preview proved, then its submit; a cut form keeps its minimum row.
 * Inside the auth card the submit is the card's full-width button (as the real form renders it),
 * while an app-page form keeps the smaller right-aligned action.
 */
function FormRows({ fields, wide }: { fields: number; wide: boolean }) {
  return (
    <>
      {Array.from({ length: fields }, (_, row) => (
        <span key={row} className={INPUT} />
      ))}
      <span className={wide ? PILL_WIDE : PILL + " self-end"} />
    </>
  );
}

const BLOCK_BODY: Readonly<Record<SketchBlockKind, ReactNode>> = {
  action: <span className={PILL} />,
  board: (
    <>
      <span className={LINE_SHORT} />
      <span className={LINE_FULL + " mt-1"} />
      <span className={LINE_FULL + " mt-0.5 w-4/5"} />
    </>
  ),
  branch: (
    <span className="flex w-3/4 flex-col items-center gap-0.5">
      <span className={BRANCH_LINE + " w-full"} />
      <span className={BRANCH_LINE_FAINT + " w-2/3"} />
    </span>
  ),
  // Forms are the one block with a shape parameter; FormRows draws them.
  form: null,
  heading: (
    <>
      <span className={HEADING_TITLE} />
      <span className={HEADING_SUBTITLE} />
    </>
  ),
  list: (
    <>
      <span className={LINE_SHORT} />
      <span className={LINE_FULL} />
      <span className={LINE_FULL} />
      <span className={LINE_FULL} />
    </>
  ),
  media: <span className={MEDIA_DOT} />,
  text: (
    <>
      <span className={LINE_FULL} />
      <span className={LINE_SHORT} />
      <span className={LINE_FAINT} />
    </>
  ),
};

/** The auth card holds a bare form and a footer link separated by a rule, as the real card does. */
const FLUSH_FORM_BOX = "flex flex-col justify-center gap-1 px-1";
const FLUSH_ACTION_BOX = "flex items-center border-t border-border/60 px-1 pt-1.5";

function boxClass(kind: SketchBlockKind, flush: boolean): string {
  if (flush && kind === "form") return FLUSH_FORM_BOX;
  if (flush && kind === "action") return FLUSH_ACTION_BOX;
  return BLOCK_BOX[kind];
}

function BlockBody({ block, wide, flush }: { block: SketchBlock; wide: boolean; flush: boolean }) {
  if (block.kind === "form") return <FormRows fields={block.fields ?? 1} wide={wide} />;
  // The auth card's footer is copy with a link, not a button.
  if (flush && block.kind === "action") return <span className={LINE_SHORT} />;
  return BLOCK_BODY[block.kind];
}

function Blocks({
  blocks,
  grow,
  flush,
  className,
}: {
  blocks: readonly SketchBlock[];
  grow: boolean;
  flush: boolean;
  className: string;
}) {
  const weight = blocks.reduce((total, block) => total + block.weight, 0);
  const slack = Math.max(0, CONTENT_WEIGHT - weight);
  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <div
          // Index keys are right: the blocks are a positional skeleton, not identities.
          key={index}
          className={boxClass(block.kind, flush)}
          style={grow ? { flexGrow: block.weight, flexBasis: 0 } : undefined}
        >
          <BlockBody block={block} wide={flush} flush={flush} />
        </div>
      ))}
      {grow && slack > 0 && <div aria-hidden="true" style={{ flexGrow: slack, flexBasis: 0 }} />}
    </div>
  );
}

function Rail() {
  return (
    <div className={RAIL}>
      <span className={RAIL_LOGO} />
      <span className={RAIL_ITEM} />
      <span className={RAIL_ITEM_FAINT} />
      <span className={RAIL_ITEM_FAINT} />
      <span className={RAIL_AVATAR} />
    </div>
  );
}

function TopBar() {
  return (
    <div className={TOP_BAR}>
      <span className={TOP_BAR_LABEL} />
      <span className={TOP_BAR_DOT} />
      <span className={TOP_BAR_DOT} />
    </div>
  );
}

function AppShell({ sketch }: { sketch: PageSketch }) {
  return (
    <>
      {sketch.rail && <Rail />}
      <div className="flex min-w-0 flex-1 flex-col">
        {sketch.header && <TopBar />}
        <Blocks blocks={sketch.blocks} grow flush={false} className={CONTENT} />
      </div>
    </>
  );
}

function AuthScreen({ sketch }: { sketch: PageSketch }) {
  return (
    <>
      <div className={AUTH_BRAND}>
        <span className={AUTH_BRAND_LOGO}>
          <span className={AUTH_BRAND_MARK} />
          <span className={AUTH_BRAND_NAME} />
        </span>
        <div className={AUTH_BRAND_BODY}>
          <div className={AUTH_BRAND_GROUP}>
            <span className={AUTH_BRAND_LINE + " w-1/3"} />
            <span className={AUTH_BRAND_LINE + " w-5/6"} />
            <span className={AUTH_BRAND_LINE + " w-2/3"} />
          </div>
          <div className={AUTH_BRAND_GROUP}>
            {[0, 1, 2].map((row) => (
              <span key={row} className={AUTH_BRAND_POINT}>
                <span className={AUTH_BRAND_DOT} />
                <span className={AUTH_BRAND_POINT_LINE} />
              </span>
            ))}
          </div>
        </div>
        <span className={AUTH_BRAND_LINE + " w-2/3"} />
      </div>
      <div className={AUTH_STAGE}>
        <div className={AUTH_CARD}>
          <Blocks blocks={sketch.blocks} grow={false} flush className={STACK} />
        </div>
      </div>
    </>
  );
}

function BarePage({ sketch }: { sketch: PageSketch }) {
  return (
    <div className={BARE}>
      <div className={BARE_COLUMN}>
        <Blocks blocks={sketch.blocks} grow={false} flush={false} className={STACK} />
      </div>
    </div>
  );
}

export function ProjectGraphPageSketch({
  preview,
  className,
}: {
  preview: PagePreview;
  className?: string;
}) {
  const sketch = useMemo(() => buildPageSketch(preview), [preview]);
  return (
    <div
      data-testid="project-graph-page-sketch"
      aria-hidden="true"
      className={cn(FRAME, "aspect-[2/1] w-full", className)}
    >
      {sketch.layout === "auth" && <AuthScreen sketch={sketch} />}
      {sketch.layout === "app" && <AppShell sketch={sketch} />}
      {sketch.layout === "plain" && <BarePage sketch={sketch} />}
    </div>
  );
}
