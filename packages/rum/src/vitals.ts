/**
 * Core Web Vitals as spans (D-203 §2, D-208). The browser.web_vital semantic convention is
 * still Development status: this pins its name/value/rating triple and adapts it to spans,
 * because the ingestion class accepts spans only (there is no metric surface). The
 * standard web-vitals build is used, never attribution: attribution entries carry element
 * selectors and other PII.
 */
import type { Attributes, Tracer } from "@opentelemetry/api";
import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";
import type { Metric } from "web-vitals";

export const WEB_VITAL_SPAN_NAME = "browser.web_vital";

/** Pure mapping for tests: the pinned semconv triple, nothing else. */
export function mapVital(metric: Metric): Attributes {
  return {
    "browser.web_vital.name": metric.name,
    "browser.web_vital.value": metric.value,
    "browser.web_vital.rating": metric.rating,
  };
}

export function wireVitals(tracer: Tracer): void {
  const report = (metric: Metric): void => {
    // One span per metric report, ended immediately so the batch processor picks it up.
    const span = tracer.startSpan(WEB_VITAL_SPAN_NAME, { attributes: mapVital(metric) });
    span.end();
  };
  onLCP(report);
  onINP(report);
  onCLS(report);
  onFCP(report);
  onTTFB(report);
}
