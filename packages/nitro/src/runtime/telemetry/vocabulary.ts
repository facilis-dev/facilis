/**
 * The framework attribute vocabulary (D-203 §1-§2).
 *
 * Telemetry is value-free by construction: every attribute below is derived from a declaration
 * or from request metadata (method, route template, status, declared relation) and never from a
 * URL, a query string, a body, a header value or a bind parameter. Keep every name in this file
 * so the allowed set stays reviewable in one place.
 */
import type { Attributes } from "@opentelemetry/api";
import type { QueryDescriptor } from "@facilis.dev/db";

/** Resource attributes (OTel resource semantic conventions): who exported, from where. */
export const SERVICE_NAME = "service.name";
export const DEPLOYMENT_ID = "deployment.id";

export const HTTP_METHOD = "http.request.method";
export const HTTP_ROUTE = "http.route";
export const HTTP_STATUS = "http.response.status_code";

/** Current database semantic conventions (the spike's db.system/db.table are legacy aliases). */
export const DB_SYSTEM = "db.system.name";
export const DB_OPERATION = "db.operation.name";
export const DB_RELATION = "db.collection.name";
export const DB_SYSTEM_POSTGRESQL = "postgresql";

/**
 * Frontend RUM (D-208): the browser.web_vital semconv is still Development status, so the
 * client pins its name/value/rating triple and adapts it to spans (the ingestion class
 * accepts spans only). Error spans carry type + source; message/stack are PII, never sent.
 */
export const WEB_VITAL_NAME = "browser.web_vital.name";
export const WEB_VITAL_VALUE = "browser.web_vital.value";
export const WEB_VITAL_RATING = "browser.web_vital.rating";
export const ERROR_TYPE = "error.type";
export const RUM_SOURCE = "facilis.rum.source";

/** Fixed RUM span names: low-cardinality by construction. */
export const WEB_VITAL_SPAN_NAME = "browser.web_vital";
export const ERROR_SPAN_NAME = "browser.error";

/** Framework-namespaced attributes: no semantic convention exists for jobs or workflows. */
export const JOB_NAME = "facilis.job.name";
export const JOB_ATTEMPT = "facilis.job.attempt";
export const WORKFLOW_NAME = "facilis.workflow.name";
export const WORKFLOW_STEP = "facilis.workflow.step";
export const WORKFLOW_STEP_KIND = "facilis.workflow.step.kind";

/**
 * Span names stay low-cardinality: the matched route TEMPLATE (`/orders/:id`), never the
 * concrete path, and a fixed prefix elsewhere.
 */
export function httpSpanName(method: string | undefined, route: string | null): string {
  const verb = method === undefined || method.length === 0 ? "HTTP" : method;
  return route === null ? verb + " (unrouted)" : verb + " " + route;
}

export function dbSpanName(descriptor: QueryDescriptor): string {
  const operation = descriptor.operation.toUpperCase();
  return descriptor.relation === null ? operation : operation + " " + descriptor.relation;
}

export function dbAttributes(descriptor: QueryDescriptor): Attributes {
  const attributes: Attributes = {
    [DB_SYSTEM]: DB_SYSTEM_POSTGRESQL,
    [DB_OPERATION]: descriptor.operation,
  };
  if (descriptor.relation !== null) attributes[DB_RELATION] = descriptor.relation;
  return attributes;
}

export function jobAttributes(name: string, attempt: number): Attributes {
  return { [JOB_NAME]: name, [JOB_ATTEMPT]: attempt };
}

export function workflowAttributes(name: string, step: number, kind: string): Attributes {
  return { [WORKFLOW_NAME]: name, [WORKFLOW_STEP]: step, [WORKFLOW_STEP_KIND]: kind };
}
