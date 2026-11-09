import { describe, expect, it } from "vitest";

import { ROUTE_DESCRIPTION_MAX_CHARS, descriptionDiagnostics } from "./route-description.ts";

const SOURCE = { file: "server/routes/api/todos/index.post.ts", line: 3 };

describe("descriptionDiagnostics", () => {
  it("accepts a missing description: absence is the patch validator's rule (D-129)", () => {
    expect(descriptionDiagnostics(null, SOURCE)).toEqual([]);
  });

  it("accepts a description at the limit", () => {
    const atLimit = "x".repeat(ROUTE_DESCRIPTION_MAX_CHARS);
    expect(descriptionDiagnostics(atLimit, SOURCE)).toEqual([]);
  });

  it("warns when the description runs past the two-line budget", () => {
    const tooLong = "x".repeat(ROUTE_DESCRIPTION_MAX_CHARS + 1);
    const [entry] = descriptionDiagnostics(tooLong, SOURCE);
    expect(entry?.code).toBe("route-description-length");
    expect(entry?.severity).toBe("warning");
    expect(entry?.message).toContain(String(ROUTE_DESCRIPTION_MAX_CHARS));
    expect(entry?.source).toEqual(SOURCE);
  });
});
