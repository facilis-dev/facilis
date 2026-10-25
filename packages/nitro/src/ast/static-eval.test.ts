import { describe, expect, it } from "vitest";

import { evaluateStatic } from "./static-eval.ts";
import type { AstNode } from "./ast.ts";

function literal(value: unknown): AstNode {
  return { type: "Literal", value };
}

describe("evaluateStatic", () => {
  it("reads literals, arrays and nested object literals", () => {
    const node: AstNode = {
      type: "ObjectExpression",
      properties: [
        {
          type: "Property",
          key: { type: "Identifier", name: "dbTables" },
          value: {
            type: "ArrayExpression",
            elements: [literal("todos")],
          },
        },
        {
          type: "Property",
          key: { type: "Identifier", name: "permission" },
          value: literal("todos:read"),
        },
      ],
    };
    expect(evaluateStatic(node)).toEqual({
      ok: true,
      value: { dbTables: ["todos"], permission: "todos:read" },
    });
  });

  it("reads single-part template literals", () => {
    expect(
      evaluateStatic({
        type: "TemplateLiteral",
        expressions: [],
        quasis: [{ type: "TemplateElement", value: { raw: "hello", cooked: "hello" } }],
      }),
    ).toEqual({ ok: true, value: "hello" });
  });

  it("rejects identifiers instead of guessing", () => {
    const result = evaluateStatic({ type: "Identifier", name: "tables" });
    expect(result.ok).toBe(false);
  });

  it("rejects spreads and computed keys", () => {
    expect(
      evaluateStatic({
        type: "ObjectExpression",
        properties: [{ type: "SpreadElement", argument: literal({}) }],
      }).ok,
    ).toBe(false);
    expect(
      evaluateStatic({
        type: "ObjectExpression",
        properties: [
          {
            type: "Property",
            computed: true,
            key: { type: "Identifier", name: "key" },
            value: literal(1),
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("rejects interpolated template literals", () => {
    expect(
      evaluateStatic({
        type: "TemplateLiteral",
        expressions: [{ type: "Identifier", name: "name" }],
        quasis: [],
      }).ok,
    ).toBe(false);
  });

  it("handles negative numeric literals", () => {
    expect(
      evaluateStatic({ type: "UnaryExpression", operator: "-", argument: literal(2) }),
    ).toEqual({
      ok: true,
      value: -2,
    });
  });
});
