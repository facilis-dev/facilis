/**
 * OTLP/JSON fixture builders for the ingestion gate probes (issue #133).
 * Everything here is synthetic: the probes only prove the gates, they are not app data.
 */

const toAnyValue = (value) => {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (Number.isInteger(value)) return { intValue: String(value) };
  return { doubleValue: Number(value) };
};

const attributesOf = (record) =>
  Object.entries(record).map(([key, value]) => ({ key, value: toAnyValue(value) }));

export const hex = (character, length) => character.repeat(length);

export function probeSpan({ traceId, spanId, parentSpanId, name, attributes = {} }) {
  const start = 1_700_000_000_000_000_000n;
  return {
    traceId,
    spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    name,
    kind: 1,
    startTimeUnixNano: String(start),
    endTimeUnixNano: String(start + 1_000_000n),
    attributes: attributesOf(attributes),
  };
}

export function probePayload(spans, resourceAttributes = { "service.name": "probe-client" }) {
  return {
    resourceSpans: [
      {
        resource: { attributes: attributesOf(resourceAttributes) },
        scopeSpans: [{ spans }],
      },
    ],
  };
}
