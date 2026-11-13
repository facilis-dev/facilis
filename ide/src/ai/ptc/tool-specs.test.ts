import { describe, expect, it } from "vitest";
import { ALL_TOOL_SPECS, advertisedFor } from "./tool-specs";

describe("tool family advertisement (D-182)", () => {
  it("advertises the dependency and framework families only when the host provides them", () => {
    const names = (host: Parameters<typeof advertisedFor>[0]) =>
      advertisedFor(host).map((entry) => entry.name);
    expect(names({})).not.toContain("list_dependencies");
    expect(names({})).not.toContain("framework_reference");
    expect(names({ dependencies: {}, framework: {} })).toEqual(
      expect.arrayContaining(["list_dependencies", "framework_reference"]),
    );
  });

  it("keeps every advertised tool resolvable by name", () => {
    const all = ALL_TOOL_SPECS.map((entry) => entry.name);
    expect(all).toContain("list_dependencies");
    expect(all).toContain("framework_reference");
    expect(new Set(all).size).toBe(all.length);
  });
});
