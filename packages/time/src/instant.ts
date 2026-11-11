/**
 * Instant coercion.
 *
 * The package accepts Date objects and ISO 8601 strings only. A date-time string without an
 * offset is rejected on purpose: new Date("2026-03-29T12:00:00") is parsed in the runtime zone,
 * which would silently contradict the explicit-timeZone contract of every formatter.
 */

import { describeValue } from "./describe-value.ts";
import { isRealCalendarDate, utcDateFromParts } from "./date-only.ts";

/** An instant: a Date object or an ISO 8601 date/date-time string. */
export type DateInput = Date | string;

const ISO_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?([Zz]|[+-]\d{2}:\d{2}))?$/;

/** Throws for anything that is not a Date or an ISO 8601 instant. */
export function toInstant(value: DateInput): Date {
  if (value instanceof Date) {
    // An invalid Date carries no instant; copying keeps the caller's object untouched.
    if (Number.isNaN(value.getTime())) {
      throw new RangeError("@facilis.dev/time: received an invalid Date");
    }
    return new Date(value.getTime());
  }
  if (typeof value !== "string") {
    throw new TypeError(
      "@facilis.dev/time: expected a Date or ISO 8601 string, received " + describeValue(value),
    );
  }
  const match = ISO_INSTANT_PATTERN.exec(value);
  if (match === null) {
    throw new RangeError(
      '@facilis.dev/time: "' +
        value +
        '" is not an ISO 8601 date or date-time (a time requires a Z or +-hh:mm offset)',
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isRealCalendarDate(year, month, day)) {
    throw new RangeError('@facilis.dev/time: "' + value + '" is not a real calendar date');
  }
  const hour = readField(match[4]);
  const minute = readField(match[5]);
  const second = readField(match[6]);
  if (hour > 23 || minute > 59 || second > 59) {
    throw new RangeError('@facilis.dev/time: "' + value + '" is not a valid time of day');
  }
  const millisecond = match[7] === undefined ? 0 : Number(match[7].padEnd(3, "0"));
  const utcMs = utcDateFromParts({ year, month, day, hour, minute, second, millisecond }).getTime();
  // A date-only string names no zone; ISO 8601 (and Date.parse) read it as UTC midnight, which
  // keeps the instant independent of the runtime zone.
  return new Date(utcMs - offsetMs(match[8]));
}

function readField(value: string | undefined): number {
  return value === undefined ? 0 : Number(value);
}

function offsetMs(offset: string | undefined): number {
  if (offset === undefined || offset === "Z" || offset === "z") return 0;
  const sign = offset.startsWith("-") ? -1 : 1;
  const hours = Number(offset.slice(1, 3));
  const minutes = Number(offset.slice(4, 6));
  if (hours > 23 || minutes > 59) {
    throw new RangeError('@facilis.dev/time: "' + offset + '" is not a valid UTC offset');
  }
  return sign * (hours * 60 + minutes) * 60_000;
}
