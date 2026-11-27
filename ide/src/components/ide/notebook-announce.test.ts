// Which kernel-status transitions a screen reader hears (issue #221). The live region
// in the notebook only renders the result; the rule is testable without one.
import { describe, expect, it } from "vitest";
import { runPhase } from "./notebook-announce";

describe("runPhase", () => {
  it("announces the start of a run", () => {
    expect(runPhase("idle", "busy", false)).toBe("running");
  });

  it("announces a finished run", () => {
    expect(runPhase("busy", "idle", false)).toBe("finished");
  });

  it("announces a run that ended in an error", () => {
    expect(runPhase("busy", "idle", true)).toBe("failed");
  });

  it("says the kernel stopped when it died under a run", () => {
    expect(runPhase("busy", "dead", false)).toBe("stopped");
  });

  it("says nothing when the status did not change", () => {
    expect(runPhase("idle", "idle", false)).toBeNull();
    expect(runPhase("busy", "busy", true)).toBeNull();
  });
});
