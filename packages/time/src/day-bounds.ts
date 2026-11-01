/**
 * The UTC instants at which a local calendar day starts and ends.
 *
 * Boundaries are anchored on local midnight and computed by probing the zone offset instead of
 * adding to a naive local time: a DST day can be 23 or 25 hours long, so only the wall clock
 * and the zone offset tell the truth.
 */

import { addDays, parseDateOnly, utcDateFromParts, type DateOnlyParts } from "./date-only.ts";
import {
  assertTimeZone,
  isSameWallTime,
  wallPartsAt,
  zoneOffsetMs,
  type WallTime,
} from "./zone.ts";

/** UTC instant of local 00:00 on the calendar day in the zone (DST-aware). */
export function startOfDay(dateOnly: string, timeZone: string): Date {
  assertTimeZone(timeZone);
  return new Date(startOfDayMs(parseDateOnly(dateOnly), timeZone));
}

/** UTC instant of local 23:59:59.999 on the calendar day in the zone (DST-aware). */
export function endOfDay(dateOnly: string, timeZone: string): Date {
  assertTimeZone(timeZone);
  // The first millisecond of the next local day is a day's exclusive end in every zone, and
  // subtracting one also handles a day whose final local second the zone skips.
  return new Date(startOfDayMs(addDays(parseDateOnly(dateOnly), 1), timeZone) - 1);
}

function startOfDayMs(dateOnly: DateOnlyParts, timeZone: string): number {
  const midnight: WallTime = {
    year: dateOnly.year,
    month: dateOnly.month,
    day: dateOnly.day,
    hour: 0,
    minute: 0,
    second: 0,
  };
  // The instant of a wall-clock time is not a function of that time alone: a DST transition can
  // repeat it or skip it, so the offset is probed on both sides of the naive instant.
  const naive = utcDateFromParts(midnight).getTime();
  const firstProbe = naive - zoneOffsetMs(naive, timeZone);
  const secondProbe = naive - zoneOffsetMs(firstProbe, timeZone);
  const candidates = [firstProbe, secondProbe].filter((candidate) =>
    isSameWallTime(wallPartsAt(candidate, timeZone), midnight),
  );
  // Repeated local midnight (fall back): pick the earliest occurrence, so startOfDay - 1 ms is
  // still the previous day. Skipped local midnight (spring forward): the day starts at the
  // transition, which is the later probe.
  return candidates.length > 0 ? Math.min(...candidates) : Math.max(firstProbe, secondProbe);
}
