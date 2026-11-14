// Weekly buckets for the created-per-week chart (PATTERNS §2.3): the server fills the gaps,
// so the client never does date math and an empty week stays a data point.

export interface WeekBucket {
  /** ISO date of the week's Monday. */
  weekStart: string;
  count: number;
}

const DAY_MS = 86_400_000;
export const MAX_WEEKS = 26;

/** The Monday (UTC) of the week containing `date`. */
export function weekStartOf(date: Date): Date {
  const day = date.getUTCDay();
  const offset = (day + 6) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - offset));
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `weeks` buckets, oldest first, zeros included; dates outside the window are dropped. */
export function weekBuckets(
  dates: readonly Date[],
  weeks: number,
  now: Date = new Date(),
): WeekBucket[] {
  const current = weekStartOf(now);
  const buckets: WeekBucket[] = [];
  const index = new Map<string, number>();

  for (let offset = weeks - 1; offset >= 0; offset -= 1) {
    const start = new Date(current.getTime() - offset * 7 * DAY_MS);
    index.set(isoDate(start), buckets.length);
    buckets.push({ weekStart: isoDate(start), count: 0 });
  }

  for (const date of dates) {
    const position = index.get(isoDate(weekStartOf(date)));
    if (position === undefined) continue;
    const bucket = buckets[position];
    if (bucket !== undefined) bucket.count += 1;
  }

  return buckets;
}
