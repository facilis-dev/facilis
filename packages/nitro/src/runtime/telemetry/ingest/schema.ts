/**
 * OTLP/JSON export-request schema (spec §8.8): Zod validation answers 400 on malformed
 * input. uint64 fields accept the canonical decimal string AND a JSON number — browser
 * SDKs emit numbers (spike F7) — and unknown span fields are ignored, not rejected.
 */
import { z } from "zod";

const HEX_TRACE_ID = /^[0-9a-f]{32}$/;
const HEX_SPAN_ID = /^[0-9a-f]{16}$/;
const NANO = z.union([
  z.number().nonnegative(),
  z.string().regex(/^\d+$/),
  z.string().regex(/^\d+n$/),
]);

/** OTLP/JSON AnyValue: the full protobuf-JSON shape, not a subset (clients send all of them). */
export type AnyValue = {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
  bytesValue?: string;
  arrayValue?: { values: AnyValue[] };
  kvlistValue?: { values: { key: string; value: AnyValue }[] };
};

export interface OtlpAttribute {
  key: string;
  value: AnyValue;
}

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number;
  startTimeUnixNano: string | number;
  endTimeUnixNano: string | number;
  attributes?: OtlpAttribute[];
  status?: { code?: number; message?: string };
}

export interface OtlpExportRequest {
  resourceSpans: {
    resource?: { attributes?: OtlpAttribute[] };
    scopeSpans: { spans: OtlpSpan[] }[];
  }[];
}

const anyValueSchema: z.ZodType<AnyValue> = z.lazy(() =>
  z.union([
    z.object({ stringValue: z.string() }),
    z.object({ boolValue: z.boolean() }),
    z.object({ intValue: NANO }),
    z.object({ doubleValue: z.number() }),
    z.object({ bytesValue: z.string() }),
    z.object({ arrayValue: z.object({ values: z.array(anyValueSchema) }) }),
    z.object({
      kvlistValue: z.object({
        values: z.array(z.object({ key: z.string().min(1).max(256), value: anyValueSchema })),
      }),
    }),
  ]),
) as z.ZodType<AnyValue>;

const attributeSchema = z.object({
  key: z.string().min(1).max(256),
  value: anyValueSchema,
});

const spanSchema = z.object({
  traceId: z.string().regex(HEX_TRACE_ID),
  spanId: z.string().regex(HEX_SPAN_ID),
  parentSpanId: z.string().regex(HEX_SPAN_ID).optional(),
  name: z.string().min(1).max(256),
  kind: z.number().optional(),
  startTimeUnixNano: NANO,
  endTimeUnixNano: NANO,
  attributes: z.array(attributeSchema).max(128).optional(),
  status: z.object({ code: z.number().optional(), message: z.string().optional() }).optional(),
});

export const exportRequestSchema: z.ZodType<OtlpExportRequest> = z.object({
  resourceSpans: z
    .array(
      z.object({
        resource: z.object({ attributes: z.array(attributeSchema).max(64) }).optional(),
        scopeSpans: z.array(z.object({ spans: z.array(spanSchema) })).max(64),
      }),
    )
    .min(1)
    .max(64),
}) as z.ZodType<OtlpExportRequest>;

/** Total spans in a batch, used for the batch cap and the span/min rate charge. */
export function countSpans(payload: OtlpExportRequest): number {
  let total = 0;
  for (const resourceSpan of payload.resourceSpans) {
    for (const scopeSpan of resourceSpan.scopeSpans) {
      total += scopeSpan.spans.length;
    }
  }
  return total;
}
