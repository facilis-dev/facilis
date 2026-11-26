import { describe, expect, it } from "vitest";
import { RUN_DEVICE_LIMITS, classifyRunRisk, type RunDeviceSignals } from "./run-consent";

const base: RunDeviceSignals = {
  coarsePointer: false,
  hoverNone: false,
  deviceMemoryGb: 8,
  cores: 16,
};

const signals = (patch: Partial<RunDeviceSignals>): RunDeviceSignals => ({ ...base, ...patch });

describe("classifyRunRisk", () => {
  it("keeps a desktop with a mouse on the direct path", () => {
    expect(classifyRunRisk(base)).toBe("ok");
  });

  it("asks on a touch-first device even when it reports 8 GB", () => {
    // A phone is limited by the tab's shared heap, not by the RAM the browser reports.
    expect(classifyRunRisk(signals({ coarsePointer: true, hoverNone: true }))).toBe("limited");
  });

  it("asks on a phone that hides deviceMemory (Safari)", () => {
    expect(
      classifyRunRisk(
        signals({ coarsePointer: true, hoverNone: true, deviceMemoryGb: null, cores: null }),
      ),
    ).toBe("limited");
  });

  it("does not ask on a touchscreen laptop, which still has a hover pointer", () => {
    expect(classifyRunRisk(signals({ coarsePointer: true, hoverNone: false }))).toBe("ok");
  });

  it("asks on a weak desktop, but only when memory and cores are both low", () => {
    expect(classifyRunRisk(signals({ deviceMemoryGb: 4, cores: 4 }))).toBe("limited");
    expect(classifyRunRisk(signals({ deviceMemoryGb: 4, cores: 8 }))).toBe("ok");
    expect(classifyRunRisk(signals({ deviceMemoryGb: 8, cores: 2 }))).toBe("ok");
  });

  it("treats an unknown memory reading as not-a-reason on a non-touch device", () => {
    expect(classifyRunRisk(signals({ deviceMemoryGb: null, cores: null }))).toBe("ok");
  });

  it("pins the thresholds a reviewer can argue with", () => {
    expect(RUN_DEVICE_LIMITS.minDeviceMemoryGb).toBe(4);
    expect(RUN_DEVICE_LIMITS.minCores).toBe(4);
  });
});
