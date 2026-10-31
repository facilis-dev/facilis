/**
 * The calendar day of an instant, read in an explicit zone.
 */

import { serializeDateOnly } from "./date-only.ts";
import { toInstant, type DateInput } from "./instant.ts";
import { wallPartsAt, type WallParts } from "./zone.ts";

/** The YYYY-MM-DD the instant falls on in the zone (defaults to the runtime zone). */
export function dateOnlyOf(value: DateInput, timeZone?: string): string {
  const instant = toInstant(value);
  const parts = wallPartsAt(instant.getTime(), timeZone);
  assertCalendarDayRange(parts);
  return serializeDateOnly(parts);
}

/** dateOnlyOf(now, timeZone) - "today" always means "today in that zone". */
export function today(timeZone?: string, now: DateInput = new Date()): string {
  return dateOnlyOf(now, timeZone);
}

function assertCalendarDayRange(parts: WallParts): void {
  // The pinned gregory formatter reports BCE years as positive numbers with a "BC" era; neither
  // those nor years above 9999 can be written as a YYYY-MM-DD calendar day.
  if (parts.era === "BC" || parts.year < 1 || parts.year > 9999) {
    throw new RangeError("@facilis/time: the instant is outside the supported calendar-day range");
  }
}
