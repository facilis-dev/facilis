/**
 * Intl primitives for an explicit IANA time zone.
 *
 * The runtime zone is used only when a caller omits the zone; every helper takes the resolved
 * zone explicitly so the public functions can document a single default.
 */

import { describeValue } from "./describe-value.ts";
import { utcDateFromParts } from "./date-only.ts";

/** Wall-clock fields an instant shows in a zone, plus the era token for range checks. */
export interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  era: string;
}

/** The date and time fields used to compare two wall clocks. */
export type WallTime = Pick<WallParts, "year" | "month" | "day" | "hour" | "minute" | "second">;

// Locale, numbering system and calendar are pinned so the parts are ASCII numbers of the
// proleptic Gregorian calendar whatever the runtime locale is. ICU's Gregorian calendar matches
// ISO 8601 for years 0001-9999, and the era part is what lets dateOnlyOf reject BCE instants.
const WALL_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  calendar: "gregory",
  numberingSystem: "latn",
  era: "short",
};

// Formatter construction dominates Intl formatting cost and an app uses one or two zones; the
// cap keeps caller-supplied values from growing the cache without bound.
const MAX_CACHED_FORMATTERS = 64;
const WALL_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function wallFormatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  let formatter = WALL_FORMATTERS.get(key);
  if (formatter === undefined) {
    if (WALL_FORMATTERS.size >= MAX_CACHED_FORMATTERS) WALL_FORMATTERS.clear();
    formatter = new Intl.DateTimeFormat("en-US", {
      ...WALL_FORMAT_OPTIONS,
      ...(timeZone === undefined ? {} : { timeZone }),
    });
    WALL_FORMATTERS.set(key, formatter);
  }
  return formatter;
}

/** Rejects non-string zones up front; a syntactically invalid zone throws RangeError from Intl. */
export function assertTimeZone(timeZone: unknown): asserts timeZone is string {
  if (typeof timeZone !== "string") {
    throw new TypeError(
      "@facilis.dev/time: expected a time zone string, received " + describeValue(timeZone),
    );
  }
}

/** Like assertTimeZone, but the omitted runtime-zone default is allowed. */
export function assertOptionalTimeZone(timeZone: unknown): asserts timeZone is string | undefined {
  if (timeZone !== undefined && typeof timeZone !== "string") {
    throw new TypeError(
      "@facilis.dev/time: expected a time zone string, received " + describeValue(timeZone),
    );
  }
}

/** The wall-clock fields an instant shows in a zone (defaults to the runtime zone). */
export function wallPartsAt(instantMs: number, timeZone: string | undefined): WallParts {
  assertOptionalTimeZone(timeZone);
  const values = new Map<string, string>();
  for (const part of wallFormatterFor(timeZone).formatToParts(new Date(instantMs))) {
    values.set(part.type, part.value);
  }
  return {
    year: readNumberPart(values, "year"),
    month: readNumberPart(values, "month"),
    day: readNumberPart(values, "day"),
    hour: readNumberPart(values, "hour"),
    minute: readNumberPart(values, "minute"),
    second: readNumberPart(values, "second"),
    era: readTextPart(values, "era"),
  };
}

/** Offset of the zone at an instant, in milliseconds (local wall time minus UTC). */
export function zoneOffsetMs(instantMs: number, timeZone: string | undefined): number {
  // Whole seconds keep the subtraction exact; UTC offsets never carry a fraction of a second.
  const floored = Math.floor(instantMs / 1000) * 1000;
  return utcDateFromParts(wallPartsAt(floored, timeZone)).getTime() - floored;
}

/** Whether two wall clocks name the same local date and time (the era is metadata, not time). */
export function isSameWallTime(left: WallTime, right: WallTime): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function readNumberPart(values: Map<string, string>, type: string): number {
  return Number(readTextPart(values, type));
}

function readTextPart(values: Map<string, string>, type: string): string {
  const value = values.get(type);
  if (value === undefined) {
    // WALL_FORMAT_OPTIONS fixes the part set, so a missing part is an Intl contract violation.
    throw new Error('@facilis.dev/time: Intl.DateTimeFormat did not return the "' + type + '" part');
  }
  return value;
}
