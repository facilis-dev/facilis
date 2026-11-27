/**
 * The declared `runtime` / `public` sections of `facilis.config.ts` (D-224).
 *
 * Read apart from the security config so `config.ts` stays under the 300-line limit and the
 * declaration rules live in one place. A value outside the static subset is an explicit unknown,
 * never an error: only the app knows how it computes the value, and the boot validates it.
 */
import { isSecretMarker, type JsonValue } from "@facilis.dev/core/runtime-config";

import type { AstNode } from "../ast/node.ts";
import type { StaticContext } from "../static-eval.ts";
import type { ConfigRuntimeFacts, RuntimeKeyFact } from "../types-runtime.ts";
import { isRecord, readStaticObject, refOf, type StaticObject } from "./static-read.ts";

interface SectionRead {
  readonly facts: Readonly<Record<string, RuntimeKeyFact>>;
  readonly unknown: boolean;
}

export function readConfigRuntime(
  root: StaticObject,
  context: StaticContext,
): ConfigRuntimeFacts {
  const runtime = readSection(root, "runtime", context);
  const publicSection = readSection(root, "public", context);
  return {
    runtime: runtime.facts,
    public: publicSection.facts,
    runtimeUnknown: runtime.unknown,
    publicUnknown: publicSection.unknown,
  };
}

function readSection(root: StaticObject, name: string, context: StaticContext): SectionRead {
  const field = root.fields.get(name);
  if (field === undefined) return { facts: {}, unknown: false };
  const read = readStaticObject(field.node, context, { code: "config-static", report: false });
  const facts: Record<string, RuntimeKeyFact> = {};
  for (const [key, value] of read.fields) {
    facts[key] = factOf(value.ok, value.value, value.node, context);
  }
  // A spread or computed section hides keys the app may declare, so a missing key is unprovable.
  return { facts, unknown: read.structuralUnknown };
}

function factOf(
  ok: boolean,
  value: unknown,
  node: AstNode | undefined,
  context: StaticContext,
): RuntimeKeyFact {
  const source = refOf(context, node);
  if (!ok) return { state: "unknown", value: undefined, source };
  // The only way "declared but unset" can arise: evaluateStatic resolves the identifier
  // `undefined` (or an expression yielding it) to the JavaScript undefined value. A missing
  // entry is not in the map at all, and every other value is JSON.
  if (value === undefined) return { state: "unset", value: undefined, source };
  if (isSecretMarker(value)) return { state: "secret", value: undefined, source };
  const literal = jsonValue(value);
  if (literal === undefined) return { state: "unknown", value: undefined, source };
  return { state: "literal", value: literal, source };
}

/** The static subset produces JSON values; anything else is an unknown, never a guessed literal. */
function jsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    for (const item of value) {
      const converted = jsonValue(item);
      if (converted === undefined) return undefined;
      items.push(converted);
    }
    return items;
  }
  if (isRecord(value)) {
    const record: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const converted = jsonValue(item);
      if (converted === undefined) return undefined;
      record[key] = converted;
    }
    return record;
  }
  return undefined;
}