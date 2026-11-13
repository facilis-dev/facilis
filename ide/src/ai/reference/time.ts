import type { FrameworkModule } from "../framework-reference";

/**
 * `@facilis.dev/time` — zero-dependency date/time logic (D-123).
 *
 * Every formatter takes an explicit locale and IANA time zone; calendar days are YYYY-MM-DD
 * strings, and day boundaries are DST-aware because a local day can be 23 or 25 hours long.
 */
export const TIME_MODULE: FrameworkModule = {
  id: "time",
  package: "@facilis.dev/time",
  summary:
    "Intl-based formatting with an explicit locale/zone, calendar days as YYYY-MM-DD and DST-aware day boundaries.",
  entries: [
    {
      name: "dateOnlyOf",
      kind: "function",
      signature: "dateOnlyOf(value: DateInput, timeZone?: string): string",
      summary:
        "The YYYY-MM-DD calendar day an instant falls on in the given zone (defaults to the runtime zone); throws for an invalid instant or an out-of-range year.",
    },
    {
      name: "today",
      kind: "function",
      signature: "today(timeZone?: string, now?: DateInput): string",
      summary:
        '"Today" always in the given zone — dateOnlyOf(now, timeZone) — so a server near midnight does not offset the wrong day.',
    },
    {
      name: "isValidDateOnly",
      kind: "function",
      signature: "isValidDateOnly(value: unknown): value is string",
      summary:
        "Strict guard for the calendar-day contract: non-strings are not dates rather than errors, so a Zod refinement can use it directly.",
    },
    {
      name: "parseDateOnly",
      kind: "function",
      signature: "parseDateOnly(value: unknown): DateOnlyParts",
      summary:
        "Parses YYYY-MM-DD into year/month/day fields (the single source of truth for the format), throwing a TypeError/RangeError on bad input.",
    },
    {
      name: "startOfDay",
      kind: "function",
      signature: "startOfDay(dateOnly: string, timeZone: string): Date",
      summary:
        "UTC instant of local 00:00 on that calendar day, DST-aware: it probes the zone offset instead of adding to a naive local time.",
    },
    {
      name: "endOfDay",
      kind: "function",
      signature: "endOfDay(dateOnly: string, timeZone: string): Date",
      summary:
        "UTC instant of local 23:59:59.999 on that calendar day, usable as an exclusive range end with >= startOfDay and < endOfDay + 1 ms.",
    },
    {
      name: "formatDate",
      kind: "function",
      signature: "formatDate(value: DateInput, options?: FormatOptions): string",
      summary:
        "Localized medium-style date in the requested locale/zone; FormatOptions carries locale and timeZone, and formatters are cached (capped).",
    },
    {
      name: "formatDateTime",
      kind: "function",
      signature: "formatDateTime(value: DateInput, options?: FormatOptions): string",
      summary: "Localized medium date plus short time in the requested locale and time zone.",
    },
    {
      name: "formatDateOnly",
      kind: "function",
      signature: "formatDateOnly(value: string, options?: DateOnlyFormatOptions): string",
      summary:
        "Localized rendering of a YYYY-MM-DD calendar day; anchored to UTC so the day never shifts with the runtime zone.",
    },
  ],
};
