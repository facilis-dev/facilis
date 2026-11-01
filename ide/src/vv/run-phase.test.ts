import { describe, expect, it, vi } from "vitest";
import { openDeployment, resolveDeployment } from "@/deploy/resolve";

import {
  advance,
  defaultRegistryFor,
  fallBackToInstall,
  formatProgress,
  isInstallFallbackLine,
  isRestoreLine,
  phaseLabel,
  readFetchProgress,
  warmRegistryConnection,
  type RunPhase,
} from "./run-phase.ts";

const base: RunPhase = {
  rootPath: "/home/user/project",
  name: "project",
  phase: "installing",
  detail: "",
  startedAt: 0,
};

const managed = resolveDeployment({
  profile: "managed",
  company: { name: "Acme", domain: "facilis.acme.example" },
  packages: { registry: "https://npm.acme.example" },
  projects: { preview: { origin: "https://preview.facilis.acme.example" } },
});

interface FakeLink {
  rel: string;
  href: string;
  crossOrigin: string | null;
}

// The warm-up touches only `document.head` and `createElement`; faking those two
// lets a node-environment test assert WHICH registry is warmed, which is the whole
// point, without pulling a DOM implementation into the suite.
function fakeDocument(): { document: Document; links: FakeLink[] } {
  const links: FakeLink[] = [];
  const head = {
    querySelector(selector: string) {
      const href = /href="([^"]+)"/.exec(selector)?.[1];
      return links.find((link) => link.rel === "preconnect" && link.href === href) ?? null;
    },
    appendChild(link: FakeLink) {
      links.push(link);
      return link;
    },
  };
  return {
    document: {
      head,
      createElement: () => ({ rel: "", href: "", crossOrigin: null }),
    } as unknown as Document,
    links,
  };
}

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

  it("warms the configured mirror in managed, the public registry in open", () => {
    expect(defaultRegistryFor(openDeployment())).toBe("https://registry.npmjs.org");
    expect(defaultRegistryFor(managed)).toBe("https://npm.acme.example");
    // resolveDeployment refuses a managed profile without a mirror, but a runtime
    // fallback to the public registry would be exactly the wrong failure mode.
    const noMirror = { ...managed, packages: { ...managed.packages, registry: null } };
    expect(defaultRegistryFor(noMirror)).toBeNull();
  });

  it("connects to the registry it is given, once, and to the compiled profile's by default", () => {
    const { document: doc, links } = fakeDocument();
    vi.stubGlobal("document", doc);
    try {
      warmRegistryConnection("https://npm.acme.example");
      warmRegistryConnection("https://npm.acme.example");
      // No argument: the compiled profile (open in tests) keeps today's behaviour.
      warmRegistryConnection();
      expect(links.map((link) => link.href)).toEqual([
        "https://npm.acme.example",
        "https://registry.npmjs.org",
      ]);
      expect(links[0].crossOrigin).toBe("anonymous");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not warm anything when the deployment has no registry", () => {
    const { document: doc, links } = fakeDocument();
    vi.stubGlobal("document", doc);
    try {
      warmRegistryConnection(null);
      expect(links).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
