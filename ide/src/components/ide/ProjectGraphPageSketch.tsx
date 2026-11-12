// The page miniature: a fixed two-pane wireframe with no labels (D-176).
//
// Two sizes share the model: the page card in the graph draws it under the card title, and the
// inspector draws the same sketch larger in place of the old labelled component tree. Both are
// decorative — the card title and the inspector section name carry the meaning — so every shape
// is aria-hidden and the drawing never takes a click: the card itself opens the details.

import { useMemo, type ReactNode } from "react";
import type { PagePreview } from "@facilis.dev/analyze";
import { cn } from "@/lib/utils";
import { buildPageSketch, type SketchBlockKind } from "@/facilis/graph-page-sketch";

const FRAME = "flex overflow-hidden rounded border border-border/70 bg-background/50";

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

/**
 * The content area is taller than a couple of regions need. Growing every block to fill it
 * made a one-region page read as a single giant box, so the leftover height stays empty page
 * (the spacer below) — blocks keep their natural proportion instead.
 */
const CONTENT_WEIGHT = 6;

/** Blocks carry a small, fixed vocabulary of shapes: no text, nothing to read at card size. */
const BLOCK_BOX: Readonly<Record<SketchBlockKind, string>> = {
  action: "flex items-center justify-start px-1",
  board: "flex flex-col justify-center rounded-sm border border-border/60 bg-card/70 p-1",
  branch:
    "flex items-center justify-center rounded-sm border border-dashed border-warning/50 bg-warning/5",
  form: "flex flex-col justify-center gap-1 rounded-sm border border-border/60 bg-card/70 px-1",
  list: "flex flex-col gap-0.5 rounded-sm border border-border/60 bg-card/70 p-1",
  media: "flex items-center justify-center rounded-sm border border-border/50 bg-muted/60",
  text: "flex flex-col justify-center gap-0.5 px-0.5",
};

const LINE_FULL = "block h-[3px] w-full rounded-full bg-muted-foreground/20";
const LINE_SHORT = "block h-[3px] w-2/3 rounded-full bg-muted-foreground/20";
const LINE_FAINT = "block h-[3px] w-1/2 rounded-full bg-muted-foreground/15";
const INPUT = "h-1.5 rounded-sm border border-border/70 bg-muted/40";
const PILL = "h-1.5 w-1/3 rounded-full bg-primary/30";
const MEDIA_DOT = "size-3 rounded-full border border-border/70 bg-background/60";
const BRANCH_LINE = "block h-[3px] rounded-full bg-warning/30";
const BRANCH_LINE_FAINT = "block h-[3px] rounded-full bg-warning/20";

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
  form: (
    <>
      <span className={INPUT} />
      <span className={INPUT} />
      <span className={PILL + " self-end"} />
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

export function ProjectGraphPageSketch({
  preview,
  className,
}: {
  preview: PagePreview;
  className?: string;
}) {
  const sketch = useMemo(() => buildPageSketch(preview), [preview]);
  const weight = sketch.blocks.reduce((total, block) => total + block.weight, 0);
  const slack = Math.max(0, CONTENT_WEIGHT - weight);
  return (
    <div
      data-testid="project-graph-page-sketch"
      aria-hidden="true"
      className={cn(FRAME, "aspect-[2/1] w-full", className)}
    >
      {sketch.rail && <Rail />}
      <div className="flex min-w-0 flex-1 flex-col">
        {sketch.header && <TopBar />}
        <div className={CONTENT}>
          {sketch.blocks.map((block, index) => (
            <div
              // Index keys are right: the blocks are a positional skeleton, not identities.
              key={index}
              className={BLOCK_BOX[block.kind]}
              style={{ flexGrow: block.weight, flexBasis: 0 }}
            >
              {BLOCK_BODY[block.kind]}
            </div>
          ))}
          {slack > 0 && <div aria-hidden="true" style={{ flexGrow: slack, flexBasis: 0 }} />}
        </div>
      </div>
    </div>
  );
}
