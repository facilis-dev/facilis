import { describe, expect, it } from "vitest";
import type { KernelBridge } from "@/vv/kernel";
import { resolveDeployment } from "@/deploy/resolve";
import { projectAdmitted } from "./admission";
import { renderAppManifest } from "./app-manifest";

function managed(admission: "facilis-only" | "any" = "facilis-only") {
  return resolveDeployment({
    profile: "managed",
    company: { name: "Acme", domain: "facilis.acme.example" },
    packages: { registry: "https://npm.acme.example" },
    projects: {
      admission,
      preview: { origin: "https://preview.facilis.acme.example" },
    },
  });
}

function bridgeReturning(contents: string): KernelBridge {
  return { request: async () => ({ ok: true, contents }) } as unknown as KernelBridge;
}

describe("admission gate", () => {
  it("never reads the VFS for the open profile", async () => {
    let called = false;
    const bridge = {
      request: async () => {
        called = true;
        return { ok: true, contents: "" };
      },
    } as unknown as KernelBridge;
    expect(await projectAdmitted(bridge, "/home/user/projects/app", resolveDeployment({}))).toBe(
      true,
    );
    expect(called).toBe(false);
  });

  it("admits a project carrying a valid marker", async () => {
    const bridge = bridgeReturning(renderAppManifest("2026.11"));
    expect(await projectAdmitted(bridge, "/home/user/projects/app/", managed())).toBe(true);
  });

  it("refuses a project without a marker", async () => {
    const bridge = { request: async () => ({ ok: false }) } as unknown as KernelBridge;
    expect(await projectAdmitted(bridge, "/home/user/projects/app", managed())).toBe(false);
  });

  it("fails closed when the VFS throws", async () => {
    const bridge = {
      request: async () => {
        throw new Error("kernel gone");
      },
    } as unknown as KernelBridge;
    expect(await projectAdmitted(bridge, "/home/user/projects/app", managed())).toBe(false);
  });

  it("admits anything when the policy is any", async () => {
    const bridge = { request: async () => ({ ok: false }) } as unknown as KernelBridge;
    expect(await projectAdmitted(bridge, "/home/user/projects/app", managed("any"))).toBe(true);
  });
});
