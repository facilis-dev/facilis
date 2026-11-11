import type { LogEntry } from "@facilis.dev/core";

/**
 * A destination for one serialized log entry (D-119).
 *
 * `append` throws when the destination is not writable; the runtime decides whether that is
 * fatal (audit) or best-effort (access/error/app).
 */
export const LOG_STREAMS = ["access", "audit", "error", "app"] as const;
export type LogStream = (typeof LOG_STREAMS)[number];

export interface LogSink {
  append(stream: LogStream, entry: LogEntry): void;
}

/**
 * One JSON object per line on stdout, for the deploy's log platform. Stdout audit lines stay
 * plain entries (no chain fields): the hash chain belongs to the file record, WORM/retention
 * is the platform's job (O-014).
 */
export function createStdoutLogSink(write: (line: string) => void = writeToStdout): LogSink {
  return {
    append(_stream, entry) {
      write(`${JSON.stringify(entry)}\n`);
    },
  };
}

function writeToStdout(line: string): void {
  process.stdout.write(line);
}
