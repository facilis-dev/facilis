/**
 * Localized formatting with an explicit locale and time zone.
 *
 * The style is fixed per function (medium date, short time) so a project gets one stable look
 * without a prop surface; anything richer is "copy the function and pick the style".
 */

import { describeValue } from "./describe-value.ts";
import { parseDateOnly, utcDateFromParts } from "./date-only.ts";
import { toInstant, type DateInput } from "./instant.ts";

/** Locale and zone for the instant formatters; both default to the runtime values. */
export interface FormatOptions {
  /** BCP 47 locale tag. */
  locale?: string;
  /** IANA time zone name. */
  timeZone?: string;
}

/** Calendar days have no zone, so only the locale applies. */
export interface DateOnlyFormatOptions {
  locale?: string;
}

type FormatKind = "date" | "date-time" | "time" | "calendar-date";

const STYLES: Record<FormatKind, Intl.DateTimeFormatOptions> = {
  date: { dateStyle: "medium" },
  "date-time": { dateStyle: "medium", timeStyle: "short" },
  time: { timeStyle: "short" },
  "calendar-date": { dateStyle: "medium" },
};

// Formatter construction dominates Intl formatting cost and an app uses a couple of
// locale/zone pairs; the cap keeps caller-supplied values from growing the cache without bound.
const MAX_CACHED_FORMATTERS = 64;
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** Localized date (medium style) in the requested zone. */
export function formatDate(value: DateInput, options: FormatOptions = {}): string {
  const { locale, timeZone } = readOptions(options);
  return formatterFor("date", locale, timeZone).format(toInstant(value));
}

/** Localized date and time in the requested zone. */
export function formatDateTime(value: DateInput, options: FormatOptions = {}): string {
  const { locale, timeZone } = readOptions(options);
  return formatterFor("date-time", locale, timeZone).format(toInstant(value));
}

/** Localized time in the requested zone. */
export function formatTime(value: DateInput, options: FormatOptions = {}): string {
  const { locale, timeZone } = readOptions(options);
  return formatterFor("time", locale, timeZone).format(toInstant(value));
}

/** Localized calendar date; it is anchored to UTC so the day never shifts. */
export function formatDateOnly(value: string, options: DateOnlyFormatOptions = {}): string {
  const { locale } = readOptions(options);
  return formatterFor("calendar-date", locale, undefined).format(
    utcDateFromParts(parseDateOnly(value)),
  );
}

interface ResolvedOptions {
  locale: string | undefined;
  timeZone: string | undefined;
}

function readOptions(options: unknown): ResolvedOptions {
  // Public parameters are typed, but generated projects are plain JS: validating the options
  // object turns a wrong call into a clear TypeError instead of a random crash.
  if (options === null || typeof options !== "object") {
    throw new TypeError(
      "@facilis.dev/time: options must be an object, received " + describeValue(options),
    );
  }
  const candidate = options as { locale?: unknown; timeZone?: unknown };
  if (candidate.locale !== undefined && typeof candidate.locale !== "string") {
    throw new TypeError(
      '@facilis.dev/time: "locale" must be a string, received ' + describeValue(candidate.locale),
    );
  }
  if (candidate.timeZone !== undefined && typeof candidate.timeZone !== "string") {
    throw new TypeError(
      '@facilis.dev/time: "timeZone" must be a string, received ' + describeValue(candidate.timeZone),
    );
  }
  return { locale: candidate.locale, timeZone: candidate.timeZone };
}

function formatterFor(
  kind: FormatKind,
  locale: string | undefined,
  timeZone: string | undefined,
): Intl.DateTimeFormat {
  const key = kind + "|" + (locale ?? "") + "|" + (timeZone ?? "");
  let formatter = FORMATTERS.get(key);
  if (formatter === undefined) {
    if (FORMATTERS.size >= MAX_CACHED_FORMATTERS) FORMATTERS.clear();
    const options: Intl.DateTimeFormatOptions = { ...STYLES[kind] };
    // Calendar days are anchored to UTC; every other kind uses the caller's zone or the runtime
    // default, which is what undefined means to Intl.
    options.timeZone = kind === "calendar-date" ? "UTC" : timeZone;
    formatter = new Intl.DateTimeFormat(locale, options);
    FORMATTERS.set(key, formatter);
  }
  return formatter;
}
