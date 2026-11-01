import { describe, expect, it } from "vitest";
import {
  csp,
  renderEnvironment,
  renderHeaders,
  renderMirrorAllowlist,
  renderProjectNpmrc,
  rewriteRegistryHint,
  type ArtifactInput,
} from "./artifacts";
import { openDeployment, resolveDeployment } from "./resolve";
import type { DeploymentInput } from "./types";

const PROVIDERS = { anthropic: "https://api.anthropic.com", openai: "https://api.openai.com/v1" };

function managed(overrides: DeploymentInput = {}) {
  return resolveDeployment({
    profile: "managed",
    company: { name: "Acme", domain: "facilis.acme.example" },
    packages: { registry: "https://npm.acme.example", allow: ["react"] },
    projects: { preview: { origin: "https://preview.facilis.acme.example" } },
    ...overrides,
  });
}

function input(overrides: DeploymentInput = {}): ArtifactInput {
  return {
    deployment: managed(overrides),
    providerHosts: PROVIDERS,
    version: "2026.11",
    configHash: "abc123",
  };
}

describe("deployment artifacts", () => {
  it("connect-src names the mirror, the preview and the provider - never npmjs", () => {
    const value = csp(input({ ai: { mode: "byo", providers: ["anthropic"] } }));
    expect(value).toContain("https://npm.acme.example");
    expect(value).toContain("https://preview.facilis.acme.example");
    expect(value).toContain("https://api.anthropic.com");
    expect(value).not.toContain("registry.npmjs.org");
  });

  it("ignores providers when AI is off", () => {
    const value = csp(input());
    expect(value).not.toContain("api.anthropic.com");
  });

  it("allows wasm compilation, the VM's eval and blob workers", () => {
    const value = csp(input());
    // wasm-unsafe-eval compiles wasm; unsafe-eval is the kernel evaluating the project
    // (measured in MANAGED-DEPLOYMENT.md §12: without it the preview never paints).
    expect(value).toContain("'wasm-unsafe-eval'");
    expect(value).toContain("'unsafe-eval'");
    expect(value).toContain("worker-src 'self' blob:");
  });

  it("managed headers carry the CSP on one line", () => {
    const lines = renderHeaders(input()).split("\n");
    expect(lines).toContain("Cross-Origin-Opener-Policy: same-origin");
    expect(lines).toContain("Cross-Origin-Embedder-Policy: require-corp");
    const policy = lines.find((line) => line.startsWith("Content-Security-Policy:"));
    expect(policy).toBeDefined();
    expect(policy).not.toContain("\n");
  });

  it("open headers carry the baseline CSP, not just isolation", () => {
    const headers = renderHeaders({
      deployment: openDeployment(),
      providerHosts: PROVIDERS,
      version: "0.0.0",
      configHash: "x",
    });
    expect(headers).toContain("Cross-Origin-Opener-Policy");
    const policy = headers.split("\n").find((line) => line.startsWith("Content-Security-Policy:"));
    expect(policy).toBeDefined();
    // No remote code, no plugins, no framing of other origins; the network stays open.
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'");
    expect(policy).toContain("frame-src 'self'");
    expect(policy).toContain("connect-src 'self' https: wss: ws: blob: data:");
    expect(policy).toContain("object-src 'none'");
  });

  it("hashes the inline scripts into script-src, in both profiles", () => {
    const managedPolicy = renderHeaders({ ...input(), inlineScripts: ["abc=", "def="] });
    expect(managedPolicy).toContain("'sha256-abc='");
    expect(managedPolicy).toContain("'sha256-def='");
    const openPolicy = renderHeaders({
      deployment: openDeployment(),
      providerHosts: PROVIDERS,
      version: "0.0.0",
      configHash: "x",
      inlineScripts: ["abc="],
    });
    expect(openPolicy).toContain("'sha256-abc='");
  });

  it("the mirror allowlist mirrors packages.allow", () => {
    const parsed = JSON.parse(renderMirrorAllowlist(managed())) as {
      registry: string;
      packages: string[];
    };
    expect(parsed.registry).toBe("https://npm.acme.example");
    expect(parsed.packages).toEqual(["react"]);
  });

  it("the generated .npmrc points at the mirror", () => {
    expect(renderProjectNpmrc(managed())).toContain("registry=https://npm.acme.example");
  });

  it("the environment manifest records policy and artifacts", () => {
    const parsed = JSON.parse(
      renderEnvironment({ ...input(), artifacts: { "index.html": "deadbeef" } }),
    ) as {
      profile: string;
      configHash: string;
      gitPush: boolean;
      artifacts: Record<string, string>;
    };
    expect(parsed.profile).toBe("managed");
    expect(parsed.configHash).toBe("abc123");
    expect(parsed.gitPush).toBe(false);
    expect(parsed.artifacts["index.html"]).toBe("deadbeef");
  });

  it("rewrites the public-registry hint for a managed build only", () => {
    const html = '<link rel="dns-prefetch" href="https://registry.npmjs.org">';
    expect(rewriteRegistryHint(html, managed())).toContain("https://npm.acme.example");
    expect(rewriteRegistryHint(html, openDeployment())).toBe(html);
  });
});
