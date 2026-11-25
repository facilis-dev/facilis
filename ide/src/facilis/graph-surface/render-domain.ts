// The overview domain card (D-211, #184; lens badges D-212, #189), split from render.ts so
// both drawing modules stay under the 300-line source limit.

import type { GraphNodeKind } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";
import type { DomainOverviewCard } from "./layout.ts";
import type { SurfacePalette } from "./palette.ts";
import {
  FONT_STATS,
  FONT_TITLE,
  SURFACE_FONT,
  roundRectPath,
  truncateText,
  type CardDrawOptions,
} from "./render.ts";

export function drawDomainCard(
  ctx: CanvasRenderingContext2D,
  card: DomainOverviewCard,
  palette: SurfacePalette,
  options: CardDrawOptions & {
    readonly matches: number | null;
    /** The active lens's flag count for this domain; null when no lens is active. */
    readonly flags: number | null;
    readonly flagColor: string;
  },
): void {
  const { rect } = card;
  ctx.globalAlpha = options.alpha;
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 14);
  ctx.fillStyle = options.active ? palette.cardActive : palette.card;
  ctx.fill();
  ctx.lineWidth = options.active ? 2 : 1;
  ctx.strokeStyle = options.active ? palette.accent : palette.border;
  ctx.stroke();
  ctx.fillStyle = palette.foreground;
  ctx.font = FONT_TITLE;
  ctx.fillText(truncateText(ctx, card.name, rect.w - 36), rect.x + 18, rect.y + 34);
  ctx.font = FONT_STATS;
  ctx.fillStyle = palette.muted;
  const stats =
    t("projectGraph.surface.nodeCount", { count: card.total }) +
    " · " +
    t("projectGraph.surface.linkCount", { count: card.links });
  ctx.fillText(truncateText(ctx, stats, rect.w - 36), rect.x + 18, rect.y + 58);
  let cx = rect.x + 18;
  const cy = rect.y + 80;
  ctx.font = SURFACE_FONT;
  for (const kind of Object.keys(card.counts) as GraphNodeKind[]) {
    const count = card.counts[kind];
    if (count === 0) continue;
    const label = t(("projectGraph.node." + kind) as MessageKey) + " " + count;
    const w = ctx.measureText(label).width + 16;
    if (cx + w > rect.x + rect.w - 12) break;
    roundRectPath(ctx, cx, cy, w, 24, 7);
    ctx.fillStyle = palette.background;
    ctx.fill();
    ctx.strokeStyle = palette.kinds[kind];
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = palette.kinds[kind];
    ctx.fillText(label, cx + 8, cy + 16);
    cx += w + 8;
  }
  ctx.fillStyle = palette.accent;
  ctx.fillText(t("projectGraph.surface.openDomain"), rect.x + 18, rect.y + rect.h - 16);
  if (options.flags !== null && options.flags > 0) {
    const label = t("projectGraph.surface.lens.flags", { count: options.flags });
    const w = ctx.measureText(label).width + 14;
    roundRectPath(ctx, rect.x + rect.w - w - 12, rect.y + 12, w, 22, 7);
    ctx.fillStyle = palette.background;
    ctx.fill();
    ctx.strokeStyle = options.flagColor;
    ctx.stroke();
    ctx.fillStyle = options.flagColor;
    ctx.fillText(label, rect.x + rect.w - w - 5, rect.y + 27);
  }
  if (options.matches !== null && options.matches > 0) {
    const label = t("projectGraph.matches", { count: options.matches });
    const w = ctx.measureText(label).width + 14;
    const y = options.flags !== null && options.flags > 0 ? rect.y + 40 : rect.y + 12;
    roundRectPath(ctx, rect.x + rect.w - w - 12, y, w, 22, 7);
    ctx.fillStyle = palette.background;
    ctx.fill();
    ctx.strokeStyle = palette.accent;
    ctx.stroke();
    ctx.fillStyle = palette.accent;
    ctx.fillText(label, rect.x + rect.w - w - 5, y + 15);
  }
  ctx.globalAlpha = 1;
}
