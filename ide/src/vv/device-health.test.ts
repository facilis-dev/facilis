import { describe, expect, it } from "vitest";
import {
  bootDurationMs,
  classifyDeviceHealth,
  DEVICE_LIMITS,
  tabHeapBytes,
  type DeviceSignals,
} from "./device-health";

/** A device nothing is wrong with: 8 GB, a small heap, plenty of storage, a fast boot. */
const healthy: DeviceSignals = {
  deviceMemoryGb: 8,
  cores: 8,
  heapUsedBytes: 300_000_000,
  heapLimitBytes: 4_000_000_000,
  guestHeapBytes: 500_000_000,
  storageUsedBytes: 1_000_000_000,
  storageQuotaBytes: 100_000_000_000,
  bootMs: 20_000,
};

const signals = (patch: Partial<DeviceSignals>): DeviceSignals => ({ ...healthy, ...patch });

describe("classifyDeviceHealth", () => {
  it("reports nothing on a device that is fine", () => {
    expect(classifyDeviceHealth(healthy)).toEqual([]);
  });

  it("reports memory pressure when page and workers together cross the advisory", () => {
    const over = signals({ guestHeapBytes: DEVICE_LIMITS.tabHeapAdvisoryBytes });
    expect(classifyDeviceHealth(over)).toContain("memory-pressure");
  });

  it("reports memory pressure when the page heap nears its own cap", () => {
    const nearCap = signals({
      heapUsedBytes: Math.round(4_000_000_000 * DEVICE_LIMITS.pageHeapPressureRatio),
      heapLimitBytes: 4_000_000_000,
      guestHeapBytes: null,
    });
    expect(classifyDeviceHealth(nearCap)).toContain("memory-pressure");
  });

  it("does not report memory pressure from the page heap alone when the cap is generous", () => {
    const modest = signals({ heapUsedBytes: 900_000_000, heapLimitBytes: 8_000_000_000, guestHeapBytes: null });
    expect(classifyDeviceHealth(modest)).not.toContain("memory-pressure");
  });

  it("reports a small device at the RAM threshold, not below it", () => {
    expect(classifyDeviceHealth(signals({ deviceMemoryGb: DEVICE_LIMITS.lowDeviceMemoryGb }))).toContain(
      "low-memory",
    );
    expect(
      classifyDeviceHealth(signals({ deviceMemoryGb: DEVICE_LIMITS.lowDeviceMemoryGb + 4 })),
    ).not.toContain("low-memory");
  });

  it("reports a slow boot at the threshold", () => {
    expect(classifyDeviceHealth(signals({ bootMs: DEVICE_LIMITS.slowBootMs }))).toContain("slow-boot");
    expect(classifyDeviceHealth(signals({ bootMs: DEVICE_LIMITS.slowBootMs - 1 }))).not.toContain("slow-boot");
  });

  it("reports nearly-full storage at the ratio", () => {
    const full = signals({
      storageUsedBytes: 92_000_000_000,
      storageQuotaBytes: 100_000_000_000,
    });
    expect(classifyDeviceHealth(full)).toContain("low-storage");
  });

  it("says nothing about storage when the browser will not estimate it", () => {
    expect(
      classifyDeviceHealth(signals({ storageUsedBytes: null, storageQuotaBytes: null })),
    ).toEqual([]);
  });

  it("orders the issues most severe first", () => {
    const bad = signals({
      deviceMemoryGb: 4,
      guestHeapBytes: DEVICE_LIMITS.tabHeapAdvisoryBytes,
      bootMs: 90_000,
      storageUsedBytes: 99_000_000_000,
    });
    expect(classifyDeviceHealth(bad)).toEqual(["memory-pressure", "low-memory", "slow-boot", "low-storage"]);
  });
});

describe("tabHeapBytes", () => {
  it("adds the page heap to the guest workers", () => {
    expect(tabHeapBytes(signals({ heapUsedBytes: 200_000_000, guestHeapBytes: 500_000_000 }))).toBe(
      700_000_000,
    );
  });

  it("uses whichever half is reported", () => {
    expect(tabHeapBytes(signals({ heapUsedBytes: null, guestHeapBytes: 500_000_000 }))).toBe(500_000_000);
    expect(tabHeapBytes(signals({ heapUsedBytes: 200_000_000, guestHeapBytes: null }))).toBe(200_000_000);
  });

  it("is null when nothing is reported", () => {
    expect(tabHeapBytes(signals({ heapUsedBytes: null, guestHeapBytes: null }))).toBeNull();
  });
});

describe("bootDurationMs", () => {
  it("measures kernel-online to preview-paint", () => {
    expect(
      bootDurationMs([
        { name: "kernel-online", t: 500 },
        { name: "install-start", t: 700 },
        { name: "preview-paint", t: 18_000 },
      ]),
    ).toBe(17_500);
  });

  it("is null before a project has painted", () => {
    expect(bootDurationMs([{ name: "kernel-online", t: 500 }])).toBeNull();
    expect(bootDurationMs([])).toBeNull();
  });

  it("is null when the marks are out of order", () => {
    expect(
      bootDurationMs([
        { name: "kernel-online", t: 18_000 },
        { name: "preview-paint", t: 500 },
      ]),
    ).toBeNull();
  });
});
