/**
 * Local-calendar helpers for the DatePicker. Everything works on local calendar days, not
 * instants: a DatePicker value is a local Date and API serialization belongs to @facilis/time.
 */

function pad2(value: number): string {
  return value < 10 ? "0" + value : String(value);
}

/** Local midnight of the given day; comparisons in the picker ignore the time part. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

/** First day of the month shifted by amount, e.g. used by the month navigation. */
export function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

/** Shifts months keeping the day, clamped to the target month (Jan 31 -> Feb 29 in a leap year). */
export function addMonthsClamped(date: Date, amount: number): Date {
  const year = date.getFullYear();
  const month = date.getMonth() + amount;
  const day = Math.min(date.getDate(), daysInMonth(year, month));
  return new Date(year, month, day);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Monday of the week containing the given day (the grid is Monday-first). */
export function mondayOf(date: Date): Date {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(startOfDay(date), offset);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Inclusive min/max bounds compared as calendar days, so a time part never excludes a bound day. */
export function isDayWithin(day: Date, minDate?: Date, maxDate?: Date): boolean {
  const time = startOfDay(day).getTime();
  if (minDate !== undefined && time < startOfDay(minDate).getTime()) return false;
  if (maxDate !== undefined && time > startOfDay(maxDate).getTime()) return false;
  return true;
}

/** Local YYYY-MM-DD key; never uses toISOString, which would shift across time zones. */
export function dayKey(date: Date): string {
  return String(date.getFullYear()) + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

/** 6 weeks x 7 days (Monday first), including the adjacent-month days needed to fill the grid. */
export function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = mondayOf(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}
