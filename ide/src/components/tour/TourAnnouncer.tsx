import { t } from "@/i18n";
import type { TourStep } from "@/tour/tour-types";

export interface TourAnnouncerProps {
  readonly step: TourStep;
  readonly index: number;
  readonly total: number;
}

/** The tour's single polite live region (issue #218). It lives in the overlay, not in the
 * keyed card: a live region must exist before its text changes to be announced, and the
 * card remounts on every step. Counter, title and body change together as one message. */
export function TourAnnouncer({ step, index, total }: TourAnnouncerProps) {
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only" data-tour-announcer="">
      {t("tour.stepOf", { current: index + 1, total })}: {t(step.titleKey)}. {t(step.bodyKey)}
    </div>
  );
}
