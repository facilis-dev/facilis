import { describe, expect, it } from "vitest";
import { openDeployment, resolveDeployment } from "./resolve";
import { webAccessFor, webUrlAllowed } from "./web-policy";

/** A valid managed profile; network.connect is the only field these tests vary. */
function managed(connect: string[]) {
  return resolveDeployment({
    profile: "managed",
    packages: { registry: "https://npm.acme.example" },
    projects: { preview: { origin: "https://preview.acme.example" } },
    network: { connect },
  });
}

const PAGE = "https://studio.acme.example";

describe("the deployment's web policy", () => {
  it("keeps an open build open, whatever network.connect says", () => {
    expect(webAccessFor(openDeployment())).toEqual({ kind: "open" });
    expect(
      webAccessFor({ ...openDeployment(), network: { connect: ["https://api.example"] } }),
    ).toEqual({ kind: "open" });
  });

  it("reduces network.connect to deduped origins", () => {
    expect(
      webAccessFor(
        managed([
          "https://api.example/path",
          "https://api.example/other",
          "https://docs.example:8443/guide",
        ]),
      ),
    ).toEqual({
      kind: "hosts",
      origins: ["https://api.example", "https://docs.example:8443"],
    });
  });

  it("drops entries that name no origin", () => {
    expect(webAccessFor(managed(["not a url", "api.example", "/relative"]))).toBeNull();
  });

  it("has no web family in a managed build that declared no host", () => {
    expect(webAccessFor(managed([]))).toBeNull();
  });
});

describe("webUrlAllowed", () => {
  const open = { kind: "open" } as const;
  const hosts = { kind: "hosts", origins: ["https://api.example"] } as const;

  it("admits any https host in an open build", () => {
    const decision = webUrlAllowed(open, "https://anywhere.example/page", PAGE);
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.url.href).toBe("https://anywhere.example/page");
  });

  it("refuses plain http except on the IDE's own origin", () => {
    expect(webUrlAllowed(open, "http://localhost:5173/api", "http://localhost:5173").ok).toBe(true);
    expect(webUrlAllowed(open, "http://anywhere.example/", PAGE).ok).toBe(false);
  });

  it("refuses a non-http protocol and a relative URL", () => {
    expect(webUrlAllowed(open, "file:///etc/passwd", PAGE).ok).toBe(false);
    expect(webUrlAllowed(open, "ws://api.example/socket", PAGE).ok).toBe(false);
    expect(webUrlAllowed(open, "data:text/plain,hi", PAGE).ok).toBe(false);
    expect(webUrlAllowed(open, "/relative/path", PAGE).ok).toBe(false);
  });

  it("refuses embedded credentials", () => {
    expect(webUrlAllowed(open, "https://user:pass@api.example/", PAGE).ok).toBe(false);
    expect(webUrlAllowed(open, "https://user@api.example/", PAGE).ok).toBe(false);
  });

  it("admits only the declared origins plus the IDE's own origin in a managed build", () => {
    expect(webUrlAllowed(hosts, "https://api.example/v1", PAGE).ok).toBe(true);
    expect(webUrlAllowed(hosts, "https://docs.example/", PAGE).ok).toBe(false);
    expect(webUrlAllowed(hosts, "https://api.example.evil.example/", PAGE).ok).toBe(false);
    // The exact origin means the exact port too.
    expect(webUrlAllowed(hosts, "https://api.example:8443/", PAGE).ok).toBe(false);
    // The IDE's own origin stays reachable in a managed build.
    expect(webUrlAllowed(hosts, "https://studio.acme.example/__facilis", PAGE).ok).toBe(true);
  });

  it("returns a reason that names the rule", () => {
    const decision = webUrlAllowed(hosts, "https://docs.example/", PAGE);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain("network.connect");
  });
});
