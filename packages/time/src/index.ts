/**
 * @facilis/time - zero-dependency date/time logic for generated projects.
 *
 * A flat, named surface: formatting with an explicit locale and time zone, calendar days as
 * YYYY-MM-DD strings, and DST-aware day boundaries. There is nothing to configure - import the
 * functions the project uses.
 */

export type { DateInput } from "./instant.ts";

export { dateOnlyOf, today } from "./calendar.ts";
export { isValidDateOnly } from "./date-only.ts";
export { endOfDay, startOfDay } from "./day-bounds.ts";
export { formatDate, formatDateOnly, formatDateTime, formatTime } from "./format.ts";
export type { DateOnlyFormatOptions, FormatOptions } from "./format.ts";
