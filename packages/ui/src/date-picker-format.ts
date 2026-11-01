/**
 * Intl formatting for the DatePicker. Kept apart from the grid helpers so the component file
 * stays small and the formats are testable without rendering.
 */

export type DatePickerMode = "date" | "datetime";

export function formatDateValue(value: Date | null, mode: DatePickerMode, locale?: string): string {
  if (value === null) return "—";
  const options: Intl.DateTimeFormatOptions =
    mode === "datetime" ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" };
  return new Intl.DateTimeFormat(locale, options).format(value);
}

export function formatMonthTitle(year: number, month: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(year, month, 1),
  );
}

export function formatDayLabel(day: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(day);
}

/** Monday-first short weekday names in the given locale (2024-01-01 was a Monday). */
export function getWeekdayLabels(locale?: string): string[] {
  const monday = new Date(2024, 0, 1);
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index)),
  );
}

export function pad2(value: number): string {
  return value < 10 ? "0" + value : String(value);
}
