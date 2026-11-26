// Search-jump resolution (D-219, issue #187): the first matched node and its domain. This is
// the pure half of "Enter or click a result drills to the node's domain"; the surface centring
// and selection are covered by safe-area/camera and draw tests.

import { describe, expect, it } from "vitest";
import type { GraphNodeKind } from "@facilis.dev/analyze";
import { firstGraphSearchJump } from "./graph-search-jump.ts";
import type { ProjectGraphNode } from "./graph-types.ts";

function node(kind: GraphNodeKind, id: string): ProjectGraphNode {
  const base = {
    id,
    kind,
    label: id,
    sourceFile: "db/schema.ts",
    position: { x: 0, y: 0 },
    matched: true,
    collapsed: false,
  };
  if (kind === "page") {
    return {
      ...base,
      data: {
        kind,
        pagePath: "/" + id,
        pageKind: "page",
        callCount: 0,
        routePaths: [],
        preview: null,
      },
    };
  }
  return {
    ...base,
    data: {
      kind: "table",
      table: id,
      columns: [],
      rlsEnabled: true,
      framework: false,
      scope: null,
      policies: [],
      unknown: false,
    },
  };
}

const NODES = [node("page", "home"), node("table", "users"), node("page", "admin")];
const DOMAIN_OF = new Map([
  ["home", "site"],
  ["users", "core"],
  ["admin", "admin"],
]);

describe("search jump", () => {
  it("picks the first matching node in model order and its domain", () => {
    const jump = firstGraphSearchJump(NODES, new Set(["admin", "users"]), DOMAIN_OF);
    expect(jump).toEqual({ nodeId: "users", domain: "core" });
  });

  it("skips matches without a drawn domain", () => {
    const jump = firstGraphSearchJump(NODES, new Set(["users", "ghost"]), DOMAIN_OF);
    expect(jump?.nodeId).toBe("users");
  });

  it("returns null when nothing matches", () => {
    expect(firstGraphSearchJump(NODES, new Set(["ghost"]), DOMAIN_OF)).toBeNull();
  });
});
