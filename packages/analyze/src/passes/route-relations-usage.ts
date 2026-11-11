/**
 * Shared state of the route-relations walk (D-157): the mutable relation-usage accumulators
 * and the per-frame scope. Kept in one module so the walk and the follow helpers agree on
 * their shape without importing each other.
 */

import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type {
  RouteElevationUsage,
  RouteRelationUse,
  RouteRelationsFact,
} from "../types-relations.ts";
import type { ElevationKind, SourceRef } from "../types.ts";
import type { DbClient, RelationIndex } from "./route-relation-resolve.ts";

export interface MutableElevation {
  readonly kind: ElevationKind;
  readonly source: SourceRef;
  readonly tables: readonly string[];
  readonly tablesUnknown: boolean;
  readonly used: Map<string, SourceRef>;
  readonly unresolved: SourceRef[];
  opaque: boolean;
}

export interface MutableUsage {
  readonly used: Map<string, SourceRef>;
  readonly unresolved: SourceRef[];
  readonly rawSql: SourceRef[];
  opaque: boolean;
  readonly elevations: MutableElevation[];
}

/** One handler or project-local helper call frame. */
export interface RelationScope {
  readonly graph: ModuleGraph;
  readonly index: RelationIndex;
  readonly file: ProjectFile;
  readonly env: Map<string, DbClient>;
  readonly aliases: Map<string, string>;
  readonly elevationFns: Map<string, ElevationKind>;
  readonly contextName: string | null;
  /** Elevation bucket of the current callback; null is the route's own ctx.db. */
  readonly elevation: number | null;
  readonly depth: number;
  readonly stack: ReadonlySet<string>;
  readonly usage: MutableUsage;
}

export function createUsage(): MutableUsage {
  return { used: new Map(), unresolved: [], rawSql: [], opaque: false, elevations: [] };
}

function bucket(scope: RelationScope): MutableElevation | MutableUsage {
  const index = scope.elevation;
  return index === null ? scope.usage : (scope.usage.elevations[index] ?? scope.usage);
}

export function addUse(scope: RelationScope, name: string, source: SourceRef): void {
  const target = bucket(scope);
  if (!target.used.has(name)) target.used.set(name, source);
}

export function addUnresolved(scope: RelationScope, source: SourceRef): void {
  bucket(scope).unresolved.push(source);
}

export function markOpaque(scope: RelationScope): void {
  bucket(scope).opaque = true;
}

function freezeElevation(elevation: MutableElevation): RouteElevationUsage {
  const used: RouteRelationUse[] = [...elevation.used].map(([name, source]) => ({ name, source }));
  return {
    kind: elevation.kind,
    source: elevation.source,
    tables: [...elevation.tables],
    used,
    unresolved: [...elevation.unresolved],
    tablesUnknown: elevation.tablesUnknown,
    opaque: elevation.opaque,
  };
}

export function freezeUsage(usage: MutableUsage): RouteRelationsFact {
  return {
    used: [...usage.used].map(([name, source]) => ({ name, source })),
    unresolved: [...usage.unresolved],
    rawSql: [...usage.rawSql],
    opaque: usage.opaque,
    elevations: usage.elevations.map(freezeElevation),
  };
}
