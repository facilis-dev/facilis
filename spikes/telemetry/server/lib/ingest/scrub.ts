import type { AnyValue, OtlpAttribute, OtlpExportRequest, OtlpSpan } from "./schema";

/**
 * Framework attribute vocabulary of D-203 §2: route template, method, status, declared table
 * names. Anything else — raw URLs, query strings, bodies, headers, user/input values — is
 * stripped before the payload is forwarded to the operator's collector.
 */
export const SPAN_ATTRIBUTE_ALLOWLIST: ReadonlySet<string> = new Set([
  "http.request.method",
  "http.route",
  "http.response.status_code",
  "db.system",
  "db.operation",
  "db.table",
]);

export const RESOURCE_ATTRIBUTE_ALLOWLIST: ReadonlySet<string> = new Set([
  "service.name",
  "deployment.environment.name",
  "telemetry.sdk.name",
  "telemetry.sdk.language",
  "telemetry.sdk.version",
]);

const UUID = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;
const NUMERIC_SEGMENT = /\/\d+(?=\/|$)/g;
const MAX_ATTRIBUTE_STRING = 128;

/** Span names are exported too: drop any query/fragment and collapse concrete ids. */
export function sanitizeSpanName(name: string): string {
  const [withoutQuery] = name.split(/[?#]/);
  return withoutQuery.replace(UUID, "/:id").replace(NUMERIC_SEGMENT, "/:id").slice(0, 120);
}

/** Allowlisted keys still carry only scalars: an allowed key must not smuggle a structure. */
function sanitizeValue(value: AnyValue): AnyValue | null {
  if (typeof value.stringValue === "string") {
    return { stringValue: value.stringValue.slice(0, MAX_ATTRIBUTE_STRING) };
  }
  if (typeof value.intValue === "string") {
    return { intValue: value.intValue };
  }
  if (typeof value.intValue === "number") {
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
): { attributes: OtlpAttribute[]; dropped: number } {
  const kept: OtlpAttribute[] = [];
  let dropped = 0;
  for (const attribute of attributes ?? []) {
    const value = allowlist.has(attribute.key) ? sanitizeValue(attribute.value) : null;
    if (value === null) {
      dropped += 1;
    } else {
      kept.push({ key: attribute.key, value });
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
        const attributes = scrubAttributes(span.attributes, SPAN_ATTRIBUTE_ALLOWLIST);
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
