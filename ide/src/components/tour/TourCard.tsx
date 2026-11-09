import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { CardPlacement, Size } from "@/tour/tour-geometry";
import type { TourStep } from "@/tour/tour-types";

export interface TourCardProps {
  readonly step: TourStep;
  readonly index: number;
  readonly total: number;
  readonly placement: CardPlacement | null;
  readonly cardSize: Size;
  readonly top: number;
  readonly left: number;
  readonly cardRef: RefObject<HTMLDivElement | null>;
  readonly onNext: () => void;
  readonly onPrev: () => void;
  readonly onSkip: () => void;
}

/** Borders per card side: the rotated square shows only the two edges that point
 * back at the highlighted element, so the arrow reads as attached to the card. */
const ARROW_EDGES: Record<CardPlacement["side"], string> = {
  top: "border-r border-b",
  bottom: "border-t border-l",
  left: "border-t border-r",
  right: "border-l border-b",
};

const ARROW_HALF = 6;

function arrowStyle(
  placement: CardPlacement,
  card: Size,
): { readonly top: number; readonly left: number } {
  switch (placement.side) {
    case "top":
      return { top: card.height - ARROW_HALF, left: placement.arrow - ARROW_HALF };
    case "bottom":
      return { top: -ARROW_HALF, left: placement.arrow - ARROW_HALF };
    case "left":
      return { top: placement.arrow - ARROW_HALF, left: card.width - ARROW_HALF };
    case "right":
      return { top: placement.arrow - ARROW_HALF, left: -ARROW_HALF };
  }
}

/** The one interactive surface of the tour: step copy, progress and the three
 * text buttons. Positioned by the overlay from the geometry module. */
export function TourCard({
  step,
  index,
  total,
  placement,
  cardSize,
  top,
  left,
  cardRef,
  onNext,
  onPrev,
  onSkip,
}: TourCardProps) {
  const side = placement?.side ?? step.placement;
  const last = index + 1 >= total;
  const arrow = placement !== null && cardSize.width > 0 ? arrowStyle(placement, cardSize) : null;

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      data-placement={side}
      style={{ top, left }}
      className={cn(
        "absolute w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none",
        "animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none",
        "data-[placement=top]:slide-in-from-bottom-1 data-[placement=bottom]:slide-in-from-top-1",
        "data-[placement=left]:slide-in-from-right-1 data-[placement=right]:slide-in-from-left-1",
      )}
    >
      {arrow !== null && (
        <div
          aria-hidden
          className={cn("absolute size-3 rotate-45 border-border bg-popover", ARROW_EDGES[side])}
          style={arrow}
        />
      )}

      <div className="flex items-center justify-between gap-2">
        <span
          aria-live="polite"
          className="text-[11px] font-medium tracking-wide text-muted-foreground"
        >
          {t("tour.stepOf", { current: index + 1, total })}
        </span>
        <Button variant="ghost" size="xs" onClick={onSkip}>
          {t("tour.skip")}
        </Button>
      </div>

      <h2 className="mt-1 text-sm font-semibold">{t(step.titleKey)}</h2>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t(step.bodyKey)}</p>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div aria-hidden className="flex items-center gap-1.5">
          {Array.from({ length: total }, (_, dot) => (
            <span
              key={dot}
              className={cn(
                "size-1.5 rounded-full transition-colors",
                dot === index ? "bg-primary" : "bg-muted-foreground/30",
              )}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={onPrev} disabled={index === 0}>
            {t("tour.back")}
          </Button>
          <Button size="sm" onClick={onNext}>
            {last ? t("tour.done") : t("tour.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
