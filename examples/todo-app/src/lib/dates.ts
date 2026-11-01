/**
 * Project-level date helpers on top of @facilis/time (docs/FRONTEND.md section 7).
 *
 * API values are ISO instants; the app decides the user's zone once and formats calendar days
 * through @facilis/time, never through Date#toLocaleString (D-undefined).
 */

import { dateOnlyOf, formatDateOnly, startOfDay, today } from "@facilis/time";

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
 * Converts the calendar day a Date falls on in the user's zone to the ISO instant of local
 * midnight, which is what the API stores. The DatePicker returns local Dates, so this is the
 * bridge to the API; an invalid Date throws instead of being sent silently.
 */
export function dueDateFromDate(date: Date, timeZone: string = localTimeZone()): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("dueDateFromDate: expected a valid Date");
  }
  return startOfDay(dateOnlyOf(date, timeZone), timeZone).toISOString();
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
