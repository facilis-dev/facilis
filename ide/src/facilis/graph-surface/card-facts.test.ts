// Per-kind content extraction tests for the rich card (issue #188): every table column is
// listed with its type and PK/NN/UQ/DEF/FK markers, route inputs keep their canonical order,
// and bounded lists report what they left out instead of silently dropping facts.

import { describe, expect, it } from "vitest";
import type { RouteInputFact } from "@facilis.dev/analyze";
import type { ColumnDetails, TableDetails } from "../graph-details.ts";
import type { GraphColumn, TableGraphData } from "../graph-types.ts";
import {
  CARD_LIST_LIMIT,
  capList,
  columnMarkers,
  foreignKeyColumns,
  routeInputKeys,
  tableCardColumns,
} from "./card-facts.ts";

const SOURCE = { file: "db/schema.ts", line: 1 };

function column(property: string, extra: Partial<ColumnDetails> = {}): ColumnDetails {
  return {
    property,
    name: property,
    type: "text",
    notNull: false,
    primaryKey: false,
    unique: false,
    default: null,
    source: SOURCE,
    ...extra,
  };
}

function tableDetails(
  columns: readonly ColumnDetails[],
  fkColumns: readonly string[] = [],
): TableDetails {
  return {
    source: SOURCE,
    columns,
    policies: [],
    foreignKeys: [
      {
        columns: fkColumns,
        targetTable: "projects",
        targetColumns: ["id"],
        onDelete: null,
        onUpdate: null,
      },
    ],
    relations: [],
  };
}

function tableData(columns: readonly GraphColumn[]): TableGraphData {
  return {
    kind: "table",
    table: "todos",
    columns,
    rlsEnabled: true,
    framework: false,
    scope: { column: "owner_id", kind: "owner" },
    policies: [],
    unknown: false,
  };
}

describe("tableCardColumns", () => {
  it("lists every analysis column with type and PK/NN/UQ/DEF/FK markers", () => {
    const details = tableDetails(
      [
        column("id", { primaryKey: true, notNull: true }),
        column("title", { unique: true }),
        column("created_at", { default: { kind: "now", value: null } }),
        column("project_id"),
        column("staging"),
      ],
      ["project_id"],
    );
    const columns = tableCardColumns(tableData([]), details);
    expect(columns.map((entry) => entry.name)).toEqual([
      "id",
      "title",
      "created_at",
      "project_id",
      "staging",
    ]);
    expect(columns.map((entry) => entry.type)).toEqual(["text", "text", "text", "text", "text"]);
    expect(columns[0]?.markers).toEqual(["pk", "nn"]);
    expect(columns[1]?.markers).toEqual(["uq"]);
    expect(columns[2]?.markers).toEqual(["def"]);
    expect(columns[3]?.markers).toEqual(["fk"]);
    expect(columns[4]?.markers).toEqual([]);
  });

  it("falls back to the node columns and keeps the unknown marker when details are missing", () => {
    const columns = tableCardColumns(
      tableData([
        {
          property: "id",
          name: "id",
          type: "text",
          markers: ["primaryKey", "notNull", "unknown"],
        },
      ]),
      null,
    );
    expect(columns).toEqual([
      { key: "id", name: "id", property: "id", type: "text", markers: ["pk", "nn", "unknown"] },
    ]);
  });

  it("keeps the node's unknown marker even when analysis details exist", () => {
    const columns = tableCardColumns(
      tableData([{ property: "staging", name: "staging", type: "text", markers: ["unknown"] }]),
      tableDetails([column("staging")]),
    );
    expect(columns[0]?.markers).toEqual(["unknown"]);
  });

  it("counts a column as FK only when a foreign key names it", () => {
    const foreignKeys = foreignKeyColumns([
      {
        columns: ["owner_id"],
        targetTable: "users",
        targetColumns: ["id"],
        onDelete: null,
        onUpdate: null,
      },
    ]);
    expect([...foreignKeys]).toEqual(["owner_id"]);
    expect(columnMarkers(column("owner_id"), foreignKeys)).toEqual(["fk"]);
    expect(columnMarkers(column("other"), foreignKeys)).toEqual([]);
  });
});

describe("routeInputKeys", () => {
  it("returns present schemas in canonical order", () => {
    const input: RouteInputFact = { body: true, form: false, query: true, params: true };
    expect(routeInputKeys(input)).toEqual(["body", "query", "params"]);
    expect(routeInputKeys({ body: false, form: false, query: false, params: false })).toEqual([]);
  });
});

describe("capList", () => {
  it("keeps the visible prefix and reports the hidden count", () => {
    const items = Array.from({ length: CARD_LIST_LIMIT + 3 }, (_, index) => index);
    expect(capList(items)).toEqual({ visible: items.slice(0, CARD_LIST_LIMIT), hidden: 3 });
  });

  it("returns everything when the list fits", () => {
    expect(capList([1, 2, 3])).toEqual({ visible: [1, 2, 3], hidden: 0 });
  });

  it("treats a negative limit as no cap rather than dropping facts", () => {
    expect(capList([1, 2, 3], -1)).toEqual({ visible: [1, 2, 3], hidden: 0 });
  });
});
