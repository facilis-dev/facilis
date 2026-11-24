/**
 * Attribute allowlist/redaction (spec §8.8, D-203 §2): only the framework vocabulary of
 * vocabulary.ts survives — route template, method, status, declared table names, the
 * framework job/workflow names. Raw URLs, query strings, bodies, headers, input values and
 * PII are stripped before the payload is forwarded to the operator's collector.
 */
import {
  DB_OPERATION,
  DB_RELATION,
  DB_SYSTEM,
  DEPLOYMENT_ID,
  HTTP_METHOD,
  HTTP_ROUTE,
  HTTP_STATUS,
  JOB_ATTEMPT,
  JOB_NAME,
  SERVICE_NAME,
  WORKFLOW_NAME,
  WORKFLOW_STEP,
  WORKFLOW_STEP_KIND,
} from "../vocabulary.ts";
import type { AnyValue, OtlpAttribute, OtlpExportRequest, OtlpSpan } from "./schema.ts";

export const SPAN_ATTRIBUTE_ALLOWLIST: ReadonlySet<string> = new Set([
  HTTP_METHOD,
  HTTP_ROUTE,
  HTTP_STATUS,
  DB_SYSTEM,
  DB_OPERATION,
  DB_RELATION,
  JOB_NAME,
  JOB_ATTEMPT,
  WORKFLOW_NAME,
  WORKFLOW_STEP,
  WORKFLOW_STEP_KIND,
]);

/**
 * Browser SDKs still emit legacy semantic conventions (spike F6): map the safe scalar
 * metadata onto the framework vocabulary before the allowlist runs. Raw-URL keys
 * (http.url, url.full, http.target) have no mapping and are stripped with everything else.
 */
const LEGACY_SPAN_KEYS: ReadonlyMap<string, string> = new Map([
  ["http.method", HTTP_METHOD],
  ["http.status_code", HTTP_STATUS],
  ["db.system", DB_SYSTEM],
  ["db.operation", DB_OPERATION],
  ["db.table", DB_RELATION],
]);

/**
 * Resource identity is value-free too: the service/deployment names plus the SDK's own
 * identification and the deployment environment (the spike's proven resource set).
 */
export const RESOURCE_ATTRIBUTE_ALLOWLIST: ReadonlySet<string> = new Set([
  SERVICE_NAME,
  DEPLOYMENT_ID,
  "deployment.environment.name",
  "telemetry.sdk.name",
  "telemetry.sdk.language",
  "telemetry.sdk.version",
]);

const UUID = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;
const NUMERIC_SEGMENT = /\/\d+(?=\/|$)/g;
const MAX_ATTRIBUTE_STRING = 128;
const MAX_SPAN_NAME = 120;

/** Span names are exported too: drop any query/fragment and collapse concrete ids. */
export function sanitizeSpanName(name: string): string {
  const withoutQuery = name.split(/[?#]/)[0] ?? "";
  return withoutQuery.replace(UUID, "/:id").replace(NUMERIC_SEGMENT, "/:id").slice(0, MAX_SPAN_NAME);
}

/** Allowlisted keys still carry only scalars: an allowed key must not smuggle a structure. */
function sanitizeValue(value: AnyValue): AnyValue | null {
  if (typeof value.stringValue === "string") {
    return { stringValue: value.stringValue.slice(0, MAX_ATTRIBUTE_STRING) };
  }
  if (typeof value.intValue === "string" || typeof value.intValue === "number") {
    return { intValue: value.intValue };
  }
  if (typeof value.doubleValue === "number") {
    return { doubleValue: value.doubleValue };
  }
  if (typeof value.boolValue === "boolean") {
    return { boolValue: value.boolValue };
  }
  return null;
}

function scrubAttributes(
  attributes: readonly OtlpAttribute[] | undefined,
  allowlist: ReadonlySet<string>,
  legacyKeys?: ReadonlyMap<string, string>,
): { attributes: OtlpAttribute[]; dropped: number } {
  const kept: OtlpAttribute[] = [];
  let dropped = 0;
  for (const attribute of attributes ?? []) {
    const key = legacyKeys?.get(attribute.key) ?? attribute.key;
    const value = allowlist.has(key) ? sanitizeValue(attribute.value) : null;
    if (value === null) {
      dropped += 1;
    } else {
      kept.push({ key, value });
    }
  }
  return { attributes: kept, dropped };
}

export interface ScrubResult {
  readonly payload: OtlpExportRequest;
  readonly droppedAttributes: number;
}

export function scrubExportRequest(payload: OtlpExportRequest): ScrubResult {
  let droppedAttributes = 0;
  const resourceSpans = payload.resourceSpans.map((resourceSpan) => {
    const resource = resourceSpan.resource;
    const resourceAttributes = scrubAttributes(resource?.attributes, RESOURCE_ATTRIBUTE_ALLOWLIST);
    droppedAttributes += resourceAttributes.dropped;
    const scopeSpans = resourceSpan.scopeSpans.map((scopeSpan) => ({
      spans: scopeSpan.spans.map((span): OtlpSpan => {
        const attributes = scrubAttributes(span.attributes, SPAN_ATTRIBUTE_ALLOWLIST, LEGACY_SPAN_KEYS);
        droppedAttributes += attributes.dropped;
        return {
          traceId: span.traceId,
          spanId: span.spanId,
          ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
          name: sanitizeSpanName(span.name),
          ...(span.kind === undefined ? {} : { kind: span.kind }),
          startTimeUnixNano: span.startTimeUnixNano,
          endTimeUnixNano: span.endTimeUnixNano,
          attributes: attributes.attributes,
          // status.message can carry arbitrary prose (error text, values): keep the code only.
          ...(span.status?.code === undefined ? {} : { status: { code: span.status.code } }),
        };
      }),
    }));
    return resource
      ? { resource: { attributes: resourceAttributes.attributes }, scopeSpans }
      : { scopeSpans };
  });
  return { payload: { resourceSpans }, droppedAttributes };
}
