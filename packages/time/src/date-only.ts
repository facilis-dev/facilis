/**
 * Calendar-day ("YYYY-MM-DD") values.
 *
 * A calendar day is a plain string in this package: it names no instant and no zone, so it must
 * never be routed through a Date in the runtime zone (that is exactly how date pickers shift a
 * day). All arithmetic here is on the proleptic Gregorian calendar, years 0001-9999.
 */

import { describeValue } from "./describe-value.ts";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days per month in a non-leap year; February is handled by isRealCalendarDate. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export interface DateOnlyParts {
  year: number;
  month: number;
  day: number;
}

/** Wall-clock fields of a local time; fields below the hour are optional. */
export interface DateTimeParts extends DateOnlyParts {
  hour?: number;
  minute?: number;
  second?: number;
  millisecond?: number;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Whether the fields name a date in the proleptic Gregorian calendar (no year range check). */
export function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const longestDay = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  return day <= longestDay;
}

/**
 * Parses a YYYY-MM-DD calendar day, throwing for everything else.
 *
 * This is the single source of truth for the format: isValidDateOnly is this parser inside a
 * try/catch, so the validator and the consumers cannot drift apart.
 */
export function parseDateOnly(value: unknown): DateOnlyParts {
  if (typeof value !== "string") {
    throw new TypeError(
      "@facilis/time: expected a YYYY-MM-DD string, received " + describeValue(value),
    );
  }
  const match = DATE_ONLY_PATTERN.exec(value);
  if (match === null) {
    throw new RangeError('@facilis/time: "' + value + '" is not a YYYY-MM-DD calendar date');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || !isRealCalendarDate(year, month, day)) {
    throw new RangeError(
      '@facilis/time: "' +
        value +
        '" is not a real calendar date between 0001-01-01 and 9999-12-31',
    );
  }
  return { year, month, day };
}

/** Strict guard for the calendar-day contract; non-strings are not dates rather than errors. */
export function isValidDateOnly(value: unknown): value is string {
  try {
    parseDateOnly(value);
    return true;
  } catch {
    return false;
  }
}

/** Serializes calendar fields as YYYY-MM-DD; callers pass an already valid date. */
export function serializeDateOnly(parts: DateOnlyParts): string {
  return pad(parts.year, 4) + "-" + pad(parts.month, 2) + "-" + pad(parts.day, 2);
}

/**
 * UTC instant of the given wall-clock fields.
 *
 * Date.UTC maps years 0-99 to 1900-1999, so the fields are applied with setUTCFullYear instead;
 * that is what keeps 0001-01-01 and 9999-12-31 correct.
 */
export function utcDateFromParts(parts: DateTimeParts): Date {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, parts.millisecond ?? 0);
  return date;
}

/** Calendar-day arithmetic, with month and year roll-over. */
export function addDays(parts: DateOnlyParts, days: number): DateOnlyParts {
  const date = utcDateFromParts({ ...parts, day: parts.day + days });
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}
