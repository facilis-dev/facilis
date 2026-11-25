/**
 * The framework's `QueryTrace` implementation (D-203 §1): the Postgres driver announces a
 * descriptor, this module turns it into a client span parented to the request (or job).
 */
import { SpanKind, SpanStatusCode, type Context, type Tracer } from "@opentelemetry/api";
import type { QueryDescriptor, QuerySpan, QueryTrace } from "@facilis.dev/db";

import { dbAttributes, dbSpanName } from "./vocabulary.ts";

export function createQueryTrace(tracer: Tracer, parent: Context): QueryTrace {
  return {
    startQuerySpan(descriptor: QueryDescriptor): QuerySpan {
      const span = tracer.startSpan(
        dbSpanName(descriptor),
        { kind: SpanKind.CLIENT, attributes: dbAttributes(descriptor) },
        parent,
      );
      return {
        end(error?: unknown): void {
          // The error itself is never recorded: driver messages can repeat statement values.
          if (error !== undefined) span.setStatus({ code: SpanStatusCode.ERROR });
          span.end();
        },
      };
    },
  };
}
