// Dev-only Studio handle for the Facilis write path.
//
// window.__ide (IdeProvider) exposes the controller; this adds the one operation the
// headless acceptance run needs to exercise without an AI provider: applyPatch. It is the
// same function ChatPanel will call — no test-only branch inside the write path itself —
// and it is installed only in dev builds, like __ide.
//
// Kept out of IdeProvider so the wiring stays a one-liner there and the signature lives
// next to the implementation it forwards to.

import type { FilePatch } from "@facilis.dev/ai";
import type { IdeController } from "@/vv/controller";
import { applyPatch, type ApplyPatchResult } from "./apply-patch";

export interface FacilisDevHandle {
  applyPatch(input: {
    patches: readonly FilePatch[];
    manifestBase?: string;
  }): Promise<ApplyPatchResult>;
}

export function installFacilisDevHandle(controller: IdeController): void {
  const handle: FacilisDevHandle = {
    applyPatch(input) {
      const root = controller.activeFolder?.rootPath;
      if (!root) return Promise.reject(new Error("no active project folder"));
      return applyPatch({
        bridge: controller.bridge,
        root,
        patches: input.patches,
        manifestBase: input.manifestBase,
      });
    },
  };
  // oxlint-disable-next-line no-underscore-dangle -- dev-only handle mirrors window.__ide.
  (window as unknown as { __facilis?: FacilisDevHandle }).__facilis = handle;
}
