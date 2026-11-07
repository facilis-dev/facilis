import { describe, expect, it } from "vitest";
import { salvagePatches } from "./salvage";

const FIRST = { path: "src/first.ts", action: "create", content: "export const a = 1;\n" };
/** Braces and quotes inside the content must not close the object early. */
const SECOND = {
  path: "db/schema.ts",
  action: "update",
  content: 'export const t = { nested: "}" };\n',
};

function raw(patches: Array<Record<string, unknown>>): string {
  return (
    '{"message":"part","patches":' +
    JSON.stringify(patches) +
    ',"notes":[],"requires_confirmation":false}'
  );
}

function cutAfter(patches: Array<Record<string, unknown>>, patch: Record<string, unknown>): string {
  const full = raw(patches);
  const end = full.indexOf(JSON.stringify(patch)) + JSON.stringify(patch).length;
  return full.slice(0, end);
}

describe("salvagePatches", () => {
  it("keeps the complete patches before the cut", () => {
    const text = cutAfter([FIRST, SECOND], SECOND);
    expect(() => JSON.parse(text)).toThrow();
    expect(salvagePatches(text)).toEqual([FIRST, SECOND]);
  });

  it("drops the patch the cut landed inside", () => {
    const full = raw([FIRST, SECOND]);
    const secondStart = full.indexOf(JSON.stringify(SECOND));
    const text = full.slice(0, secondStart + 10);
    expect(salvagePatches(text)).toEqual([FIRST]);
  });

  it("recovers objects when a separator is missing", () => {
    const text = '{"message":"x","patches":[' + JSON.stringify(FIRST) + JSON.stringify(SECOND) + "]}";
    expect(salvagePatches(text)).toEqual([FIRST, SECOND]);
  });

  it("ignores a malformed element and answers empty without a patches array", () => {
    const text = '{"message":"x","patches":[{"path":42,"action":"create"},' + JSON.stringify(FIRST) + "]";
    expect(salvagePatches(text)).toEqual([FIRST]);
    expect(salvagePatches('{"message":"cut here')).toEqual([]);
    expect(salvagePatches("not json")).toEqual([]);
  });
});
