/**
 * The DDL `@facilis/db`'s `fileLinks` expands to, expressed as analyzer facts (D-053).
 *
 * Kept apart from the call-site scan: this module mirrors the framework's fixed table shape,
 * while `schema-file-links.ts` interprets the project's arguments.
 */

import type { ColumnDefaultFact, ColumnFact, PolicyFact, SourceRef } from "../types.ts";
import type { TableDraft } from "./schema-tables.ts";

const FACILIS_FILES = "facilis_files";
export const FACILIS_FILES_BINDING = "facilisFiles";

interface ColumnInput {
  readonly property: string;
  readonly name: string;
  readonly builder: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
  readonly default: ColumnDefaultFact | null;
  readonly source: SourceRef;
}

function column(input: ColumnInput): ColumnFact {
  return { ...input, unique: false, unknown: [] };
}

/** The generated link table's columns; `parentColumn` is the `column` option. */
export function linkColumns(parentColumn: string, source: SourceRef): ColumnFact[] {
  return [
    column({
      property: "id",
      name: "id",
      builder: "uuid",
      type: "uuid",
      notNull: true,
      primaryKey: true,
      default: { kind: "random", value: null },
      source,
    }),
    column({
      property: "parentId",
      name: parentColumn,
      builder: "uuid",
      type: "uuid",
      notNull: true,
      primaryKey: false,
      default: null,
      source,
    }),
    column({
      property: "fileId",
      name: "file_id",
      builder: "uuid",
      type: "uuid",
      notNull: true,
      primaryKey: false,
      default: null,
      source,
    }),
    column({
      property: "tenantId",
      name: "tenant_id",
      builder: "tenantColumn",
      type: "uuid",
      notNull: true,
      primaryKey: false,
      default: null,
      source,
    }),
    column({
      property: "createdAt",
      name: "created_at",
      builder: "timestamp",
      type: "timestamp with time zone",
      notNull: true,
      primaryKey: false,
      default: { kind: "now", value: null },
      source,
    }),
  ];
}

export function linkPolicies(source: SourceRef): PolicyFact[] {
  return [
    { name: "tenant_isolation", command: "ALL", restrictive: true, source, unknown: [] },
    { name: "parent_access", command: "ALL", restrictive: false, source, unknown: [] },
  ];
}

/**
 * `facilis_files` as an FK target only. The link DDL references it, but a release-ref map
 * does not carry `@facilis/db`'s source, so this lookup-only draft lets the FK resolve; it is
 * never emitted as one of the project's tables.
 */
export function facilisFilesDraft(source: SourceRef): TableDraft {
  return {
    binding: FACILIS_FILES_BINDING,
    references: [],
    fact: {
      name: FACILIS_FILES,
      binding: FACILIS_FILES_BINDING,
      columns: [
        column({
          property: "id",
          name: "id",
          builder: "uuid",
          type: "uuid",
          notNull: true,
          primaryKey: true,
          default: { kind: "random", value: null },
          source,
        }),
      ],
      primaryKey: ["id"],
      foreignKeys: [],
      policies: [],
      rlsEnabled: false,
      scope: null,
      source,
      unknown: [],
    },
  };
}
