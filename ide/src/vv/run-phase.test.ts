import { describe, expect, it } from "vitest";

import {
  advance,
  fallBackToInstall,
  formatProgress,
  isInstallFallbackLine,
  isRestoreLine,
  phaseLabel,
  readFetchProgress,
  type RunPhase,
} from "./run-phase.ts";

const base: RunPhase = {
  rootPath: "/home/user/project",
  name: "project",
  phase: "installing",
  detail: "",
  startedAt: 0,
};

describe("run-phase", () => {
  it("never moves the phase backwards", () => {
    const installing = advance(base, "installing");
    expect(installing.phase).toBe("installing");
    expect(advance(installing, "restoring").phase).toBe("restoring");
    const starting = advance(advance(installing, "restoring"), "starting");
    expect(starting.phase).toBe("starting");
    // a late install line must not un-start the dev server
    expect(advance(starting, "installing").phase).toBe("starting");
    expect(advance(starting, "restoring").phase).toBe("starting");
  });

  it("clears the detail when the phase advances", () => {
    const installing: RunPhase = { ...base, detail: "47 requests · 12.4 MB" };
    expect(advance(installing, "starting")).toMatchObject({ phase: "starting", detail: "" });
  });

  it("only falls back to installing from restoring", () => {
    const restoring: RunPhase = { ...base, phase: "restoring" };
    expect(fallBackToInstall(restoring).phase).toBe("installing");
    const starting: RunPhase = { ...base, phase: "starting" };
    expect(fallBackToInstall(starting)).toBe(starting);
    const installing: RunPhase = { ...base, phase: "installing" };
    expect(fallBackToInstall(installing)).toBe(installing);
  });

  it("labels every phase", () => {
    expect(phaseLabel("installing")).toBe("Installing dependencies");
    expect(phaseLabel("restoring")).toBe("Restoring prebuilt dependencies");
    expect(phaseLabel("starting")).toBe("Starting the dev server");
  });

  it("reads the kernel's fetch progress line and fails closed", () => {
    expect(readFetchProgress("⠧ fetching · 47 requests · 12.4 MB")).toEqual({
      requests: 47,
      mb: 12.4,
    });
    expect(readFetchProgress("fetching · 1 request · 0.1 MB")).toEqual({ requests: 1, mb: 0.1 });
    expect(readFetchProgress("installing dependencies…")).toBeNull();
    expect(readFetchProgress("")).toBeNull();
  });

  it("formats progress with singular/plural and one decimal", () => {
    expect(formatProgress({ requests: 1, mb: 0.1 })).toBe("1 request · 0.1 MB");
    expect(formatProgress({ requests: 1234, mb: 12.34 })).toBe("1,234 requests · 12.3 MB");
  });

  it("recognises the restore announcement and the fallback line", () => {
    expect(isRestoreLine("[depcache] fetching prebuilt dependencies")).toBe(true);
    expect(isRestoreLine("[depcache] restoring node_modules from OPFS")).toBe(true);
    expect(isRestoreLine("fetching prebuilt dependencies")).toBe(false);
    expect(isRestoreLine("[depcache] restored node_modules — skipping install.")).toBe(false);

    expect(isInstallFallbackLine("[depcache] snapshot unavailable — installing normally.")).toBe(
      true,
    );
    expect(isInstallFallbackLine("installing normally")).toBe(false);
  });
});
