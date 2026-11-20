/**
 * The framework service APIs' fixed table surface (D-135, D-199): ctx.tasks reads and
 * writes facilis_tasks; ctx.workflows reads and writes facilis_workflows and facilis_tasks
 * (a start inserts the workflow row and its first approval task, cancel and decide touch
 * both stores). The runtime binds both services to the request's policy-scoped transaction
 * (packages/core/src/route.ts), so a route that calls them touches exactly these tables.
 * ctx.jobs is deliberately absent: the queue store stays framework code, not a project db
 * surface (D-162).
 */

import type { ServiceKind } from "../types-relations.ts";

export const SERVICE_TABLES: Readonly<Record<ServiceKind, readonly string[]>> = {
  tasks: ["facilis_tasks"],
  workflows: ["facilis_workflows", "facilis_tasks"],
};

export function serviceKindOf(name: string | undefined): ServiceKind | null {
  return name === "tasks" || name === "workflows" ? name : null;
}
