import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isReservedRouteFile, reservedRoutePathOf } from "./reserved-route-paths.ts";

const NITRO_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../nitro/src");

function exportedRouteConstants(file: string): { name: string; value: string }[] {
  const source = readFileSync(join(NITRO_SRC, file), "utf8");
  const pattern = /export const (\w*ROUTE\w*) = "([^"]+)";/g;
  return [...source.matchAll(pattern)].map((match) => ({
    name: match[1] ?? "",
    value: match[2] ?? "",
  }));
}

describe("framework-owned route paths (D-215)", () => {
  it("covers every route constant @facilis.dev/nitro registers", () => {
    const constants = [
      ...exportedRouteConstants("constants.ts"),
      ...exportedRouteConstants("runtime/sso.ts"),
    ];
    expect(constants.length, "no route constants found").toBeGreaterThan(0);
    for (const { name, value } of constants) {
      const normalized = value.endsWith("/**") ? value.slice(0, -3) : value;
      const reserved = reservedRoutePathOf(normalized) ?? reservedRoutePathOf(value);
      expect(reserved, name + " = " + value + " is not reserved").toBeDefined();
    }
  });

  it("does not reserve the route trees the shipped examples own", () => {
    expect(reservedRoutePathOf("/api/files/{id}")).toBeUndefined();
    expect(reservedRoutePathOf("/api/jobs")).toBeUndefined();
    expect(reservedRoutePathOf("/api/jobs/{id}")).toBeUndefined();
    expect(reservedRoutePathOf("/api/auth/login")).toBeUndefined();
  });

  it("treats the reserved route directories as reserved files", () => {
    expect(isReservedRouteFile("server/routes/__facilis/x.get.ts")).toBe(true);
    expect(isReservedRouteFile("server/api/__facilis/x.get.ts")).toBe(true);
    expect(isReservedRouteFile("/home/app/server/routes/__facilis/x.get.ts")).toBe(true);
    expect(isReservedRouteFile("server/routes/api/__facilis/x.get.ts")).toBe(false);
    expect(isReservedRouteFile("server/routes/api/todos/index.get.ts")).toBe(false);
  });
});
