import { describe, expect, it } from "vitest";

import type { QueryDescriptor } from "./describe-statement.ts";
import { instrumentPostgresClient } from "./pg-query-instrumentation.ts";
import { currentQueryTrace, runWithQueryTrace, type QueryTrace } from "./query-trace.ts";

function traceRecorder(): { trace: QueryTrace; starts: QueryDescriptor[]; ends: unknown[] } {
  const starts: QueryDescriptor[] = [];
  const ends: unknown[] = [];
  return {
    starts,
    ends,
    trace: {
      startQuerySpan(descriptor) {
        starts.push(descriptor);
        return { end: (error?: unknown) => ends.push(error) };
      },
    },
  };
}

interface FakePool {
  readonly seen: unknown[][];
  query(...args: unknown[]): Promise<unknown>;
  end(): Promise<string>;
}

function fakePool(answer: () => Promise<unknown> = async () => ({ rows: [] })): FakePool {
  const seen: unknown[][] = [];
  return {
    seen,
    query: (...args: unknown[]) => {
      seen.push(args);
      return answer();
    },
    end: async () => "ended",
  };
}

describe("instrumentPostgresClient", () => {
  it("forwards every call untouched when no trace is active", async () => {
    const pool = fakePool();
    const wrapped = instrumentPostgresClient(pool);
    expect(currentQueryTrace()).toBeUndefined();
    await expect(wrapped.query("select * from documents")).resolves.toEqual({ rows: [] });
    expect(pool.seen).toHaveLength(1);
  });

  it("announces a descriptor — never the statement or its values — and ends the span", async () => {
    const pool = fakePool();
    const recorder = traceRecorder();
    const wrapped = instrumentPostgresClient(pool);

    await runWithQueryTrace(recorder.trace, () =>
      wrapped.query("select * from documents where id = $1", ["secret-token"]),
    );

    expect(recorder.starts).toEqual([{ operation: "select", relation: "documents" }]);
    expect(recorder.ends).toEqual([undefined]);
    // The bound value is visible to the driver, never to the trace.
    expect(JSON.stringify(recorder.starts)).not.toContain("secret-token");
  });

  it("marks the span failed and rethrows when the query fails", async () => {
    const failure = new Error("boom");
    const pool = fakePool(async () => Promise.reject(failure));
    const recorder = traceRecorder();
    const wrapped = instrumentPostgresClient(pool);

    await runWithQueryTrace(recorder.trace, async () => {
      await expect(wrapped.query("insert into documents (id) values ($1)", ["x"])).rejects.toBe(
        failure,
      );
    });

    expect(recorder.starts).toEqual([{ operation: "insert", relation: "documents" }]);
    expect(recorder.ends).toEqual([failure]);
  });

  it("traces the client connect() hands out, and still binds other methods", async () => {
    const recorder = traceRecorder();
    const client = fakePool();
    const pool = {
      ...fakePool(),
      connect: async () => client,
    };
    const wrapped = instrumentPostgresClient(pool);

    expect(await wrapped.end()).toBe("ended");
    const connected = (await wrapped.connect()) as FakePool;
    await runWithQueryTrace(recorder.trace, () => connected.query("update documents set a = 1"));

    expect(recorder.starts).toEqual([{ operation: "update", relation: "documents" }]);
    expect(client.seen).toHaveLength(1);
  });

  it("leaves the trace scope after the run, so a later query is untraced", async () => {
    const recorder = traceRecorder();
    const wrapped = instrumentPostgresClient(fakePool());

    await runWithQueryTrace(recorder.trace, () => wrapped.query("select 1"));
    await wrapped.query("select * from documents");

    expect(recorder.starts).toHaveLength(1);
  });
});
