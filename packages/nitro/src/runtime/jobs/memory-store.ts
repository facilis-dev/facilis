import type {
  JobCounts,
  JobOutcome,
  JobStore,
  NewStoredJob,
  StoredJob,
  StoredJobListOptions,
} from "./contracts.ts";

/** Status values come from the frozen contract so the store cannot drift from the API. */
type JobStatus = StoredJob["status"];

/** Internal row: the snapshot plus its insertion order, used as a deterministic tie-break. */
interface Row {
  readonly seq: number;
  readonly job: StoredJob;
}

const INTERRUPTED_ERROR = "interrupted (recovered after restart)";

/** Reads hand out fresh snapshots: callers must never observe a later mutation. */
function cloneJob(job: StoredJob): StoredJob {
  return {
    ...job,
    runAt: new Date(job.runAt),
    createdAt: new Date(job.createdAt),
    startedAt: job.startedAt === null ? null : new Date(job.startedAt),
    finishedAt: job.finishedAt === null ? null : new Date(job.finishedAt),
  };
}

function matchesStatus(status: JobStatus, filter: StoredJobListOptions["status"]): boolean {
  if (filter === undefined) return true;
  return typeof filter === "string" ? status === filter : filter.includes(status);
}

/** Nothing to release: the map is garbage-collected with the store. */
async function closeStore(): Promise<void> {}

/**
 * The in-memory queue: used when `jobs.persist` is false, or when the project has not
 * migrated `facilis_jobs` yet. Work is lost across a reload, which is why persistence is
 * the default (docs/JOBS.md §8).
 */
export function createMemoryJobStore(): JobStore {
  const rows = new Map<string, Row>();
  let sequence = 0;

  function replace(id: string, job: StoredJob): void {
    const row = rows.get(id);
    if (row !== undefined) rows.set(id, { seq: row.seq, job });
  }

  function byRunAt(a: Row, b: Row): number {
    return a.job.runAt.getTime() - b.job.runAt.getTime() || a.seq - b.seq;
  }

  async function insert(job: NewStoredJob): Promise<void> {
    rows.set(job.id, {
      seq: sequence++,
      job: {
        id: job.id,
        name: job.name,
        status: "queued",
        input: job.input,
        output: null,
        error: null,
        attempts: 0,
        maxAttempts: job.maxAttempts,
        timeoutMs: job.timeoutMs,
        runAt: new Date(job.runAt),
        createdAt: new Date(job.createdAt),
        startedAt: null,
        finishedAt: null,
      },
    });
  }

  async function get(id: string): Promise<StoredJob | null> {
    const row = rows.get(id);
    return row === undefined ? null : cloneJob(row.job);
  }

  async function list(options: StoredJobListOptions): Promise<StoredJob[]> {
    const matching = [...rows.values()].filter(
      ({ job }) =>
        matchesStatus(job.status, options.status) &&
        (options.name === undefined || job.name === options.name),
    );
    // Newest-created first; a later insertion wins an identical timestamp.
    matching.sort((a, b) => b.job.createdAt.getTime() - a.job.createdAt.getTime() || b.seq - a.seq);
    return matching.slice(0, Math.max(0, options.limit)).map(({ job }) => cloneJob(job));
  }

  async function queue(limit?: number): Promise<StoredJob[]> {
    const queued = [...rows.values()].filter(({ job }) => job.status === "queued");
    queued.sort(byRunAt);
    const page = limit === undefined ? queued : queued.slice(0, Math.max(0, limit));
    return page.map(({ job }) => cloneJob(job));
  }

  async function running(): Promise<StoredJob[]> {
    const active = [...rows.values()].filter(({ job }) => job.status === "running");
    active.sort(
      (a, b) =>
        (a.job.startedAt?.getTime() ?? 0) - (b.job.startedAt?.getTime() ?? 0) || a.seq - b.seq,
    );
    return active.map(({ job }) => cloneJob(job));
  }

  async function claim(now: Date, limit: number): Promise<StoredJob[]> {
    const due = [...rows.values()].filter(
      ({ job }) => job.status === "queued" && job.runAt.getTime() <= now.getTime(),
    );
    due.sort(byRunAt);
    const claimed: StoredJob[] = [];
    for (const { seq, job } of due.slice(0, Math.max(0, limit))) {
      const next: StoredJob = {
        ...job,
        status: "running",
        attempts: job.attempts + 1,
        startedAt: new Date(now),
      };
      rows.set(job.id, { seq, job: next });
      claimed.push(cloneJob(next));
    }
    return claimed;
  }

  async function complete(id: string, outcome: JobOutcome): Promise<void> {
    const row = rows.get(id);
    if (row === undefined) return;
    replace(id, {
      ...row.job,
      status: outcome.status,
      output: outcome.status === "succeeded" ? outcome.output : null,
      error: outcome.status === "succeeded" ? null : outcome.error,
      finishedAt: new Date(outcome.finishedAt),
    });
  }

  async function requeue(
    id: string,
    options: { readonly runAt: Date; readonly error: string },
  ): Promise<void> {
    const row = rows.get(id);
    if (row === undefined) return;
    replace(id, {
      ...row.job,
      status: "queued",
      output: null,
      error: options.error,
      runAt: new Date(options.runAt),
      startedAt: null,
      finishedAt: null,
    });
  }

  async function cancelQueued(id: string, finishedAt: Date): Promise<boolean> {
    const row = rows.get(id);
    if (row === undefined || row.job.status !== "queued") return false;
    replace(id, {
      ...row.job,
      status: "cancelled",
      error: null,
      finishedAt: new Date(finishedAt),
    });
    return true;
  }

  async function recoverInterrupted(now: Date): Promise<number> {
    let recovered = 0;
    for (const { job } of rows.values()) {
      if (job.status !== "running") continue;
      recovered += 1;
      if (job.attempts >= job.maxAttempts) {
        replace(job.id, {
          ...job,
          status: "failed",
          error: INTERRUPTED_ERROR,
          finishedAt: new Date(now),
        });
      } else {
        replace(job.id, {
          ...job,
          status: "queued",
          error: INTERRUPTED_ERROR,
          runAt: new Date(now),
          startedAt: null,
        });
      }
    }
    return recovered;
  }

  async function counts(): Promise<JobCounts> {
    const tally: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const { job } of rows.values()) tally[job.status] += 1;
    return { ...tally };
  }

  return {
    insert,
    get,
    list,
    queue,
    running,
    claim,
    complete,
    requeue,
    cancelQueued,
    recoverInterrupted,
    counts,
    close: closeStore,
  };
}
