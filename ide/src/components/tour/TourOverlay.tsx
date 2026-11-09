import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { centerCard, placeCard, spotlightRect, type Size } from "@/tour/tour-geometry";
import { TourCard } from "./TourCard";
import { useTour } from "./use-tour";
import { useTourTarget } from "./use-tour-target";

function viewportSize(): Size {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/** A dimmed, click-blocking layer with an animated hole around the current anchor.
 * Only the card is interactive; the scrim is painted by the spotlight's huge
 * box-shadow, so the hole is a real hole rather than a stack of overlays. */
export function TourOverlay() {
  const { snapshot, steps, next, prev, skip } = useTour();
  const step = steps[snapshot.index] ?? null;
  const target = useTourTarget(step?.anchor ?? null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardSize, setCardSize] = useState<Size>({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Size>(viewportSize);

  useEffect(() => {
    const onResize = () => setViewport(viewportSize());
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);

  // The card's own box decides where placeCard can put it; measure it whenever a
  // step remounts the card (keyed by step id in the return below).
  useLayoutEffect(() => {
    const element = cardRef.current;
    if (element === null) {
      setCardSize({ width: 0, height: 0 });
      return;
    }
    const measure = () => setCardSize({ width: element.offsetWidth, height: element.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [step?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        skip();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        prev();
      }
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, [next, prev, skip]);

  useEffect(() => {
    cardRef.current?.focus();
  }, [step?.id]);

  if (!snapshot.active || step === null) return null;

  const spotlight = target === null ? null : spotlightRect(target);
  const placement =
    spotlight === null ? null : placeCard(spotlight, cardSize, viewport, step.placement);
  const position =
    placement !== null
      ? { top: placement.top, left: placement.left }
      : centerCard(cardSize, viewport);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("tour.dialogAria")}
      data-tour-overlay=""
      className="fixed inset-0 z-50"
    >
      {spotlight === null ? (
        <div aria-hidden className="absolute inset-0 bg-overlay/70" />
      ) : (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-lg transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            // The first shadow rings the hole; the 9999px one paints the scrim,
            // so the highlighted element stays visible through the dimmer.
            boxShadow:
              "0 0 0 2px color-mix(in oklab, var(--ring) 60%, transparent), 0 0 0 9999px color-mix(in oklab, var(--overlay) 70%, transparent)",
          }}
        />
      )}

      <TourCard
        key={step.id}
        step={step}
        index={snapshot.index}
        total={steps.length}
        placement={placement}
        cardSize={cardSize}
        top={position.top}
        left={position.left}
        cardRef={cardRef}
        onNext={next}
        onPrev={prev}
        onSkip={skip}
      />
    </div>
  );
}
