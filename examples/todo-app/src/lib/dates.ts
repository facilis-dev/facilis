/**
 * Project-level date helpers on top of @facilis/time (docs/FRONTEND.md section 7).
 *
 * API values are ISO instants; the app decides the user's zone once and formats calendar days
 * through @facilis/time, never through Date#toLocaleString (D-048).
 */

import { dateOnlyOf, formatDateOnly, isValidDateOnly, startOfDay, today } from "@facilis/time";

export interface DateFormatOptions {
  locale?: string;
  timeZone?: string;
}

export interface OverdueOptions {
  /** The calendar day considered "today" (YYYY-MM-DD); injectable for tests. */
  today?: string;
  timeZone?: string;
}

/** The IANA zone the runtime is in; the app formats and converts due dates in that zone. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Formats a due-date instant as a localized calendar date, or null when there is none. */
export function formatDueDate(iso: string | null, options: DateFormatOptions = {}): string | null {
  if (iso === null) return null;
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const timeZone = options.timeZone ?? localTimeZone();
  const dateOnly = dateOnlyOf(instant, timeZone);
  return formatDateOnly(dateOnly, { locale: options.locale });
}

/**
 * Converts an <input type="date"> value to the ISO instant of local midnight, which is what the
 * API stores. Invalid calendar days throw through @facilis/time instead of being sent silently.
 */
export function dueDateFromInput(dateOnly: string, timeZone: string = localTimeZone()): string {
  if (!isValidDateOnly(dateOnly)) {
    throw new RangeError("dueDateFromInput: expected a YYYY-MM-DD calendar day");
  }
  return startOfDay(dateOnly, timeZone).toISOString();
}

/** True when the instant falls before the current calendar day in the zone. */
export function isOverdue(iso: string | null, options: OverdueOptions = {}): boolean {
  if (iso === null) return false;
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return false;
  const timeZone = options.timeZone ?? localTimeZone();
  const dueDay = dateOnlyOf(instant, timeZone);
  const todayDay = options.today ?? today(timeZone);
  return dueDay < todayDay;
}
