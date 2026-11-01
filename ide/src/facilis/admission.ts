// The VFS side of the admission gate: read facilis.app.json for a project and decide
// whether this deployment may run it (MANAGED-DEPLOYMENT.md §8).
//
// Kept out of the controller (whose size the file-length ratchet pins) and out of
// app-manifest.ts (which stays pure).

import { deployment } from "@/deploy/current";
import type { ResolvedDeployment } from "@/deploy/types";
import type { KernelBridge } from "@/vv/kernel";
import { APP_MANIFEST_FILE, admitsProject } from "./app-manifest";

/**
 * Whether the project at "root" may run. The open profile and admission "any" answer
 * without touching the VFS. A managed "facilis-only" build reads the marker and fails
 * closed: an unreadable marker or an unreadable VFS means "not admitted", because the
 * alternative is running code the policy did not vet.
 */
export async function projectAdmitted(
  bridge: KernelBridge,
  root: string,
  d: ResolvedDeployment = deployment,
): Promise<boolean> {
  if (d.profile !== "managed" || d.projects.admission === "any") return true;
  const path = root.replace(/\/+$/, "") + "/" + APP_MANIFEST_FILE;
  try {
    const res = (await bridge.request("vv-read", { path })) as {
      ok?: boolean;
      contents?: unknown;
    };
    const marker = res.ok === true && typeof res.contents === "string" ? res.contents : null;
    return admitsProject({ profile: d.profile, admission: d.projects.admission, marker });
  } catch {
    return false;
  }
}
