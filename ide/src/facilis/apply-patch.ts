// The Studio-side write path for AI patches (SPEC §10.2 "applyPatch()", §10.3 VFS rule).
//
// A generated patch reaches a project only through this function: it validates the patch
// with @facilis.dev/ai before anything touches the VFS (security invariant 9), then writes
// every file through the kernel bridge — never OPFS — which is what makes the in-VM dev
// server hot-update the preview and the OPFS mirror pick the change up.
//
// It lives beside IdeController instead of on it because controller.ts is pinned by the
// file-length ratchet (scripts/file-length-baseline.json); a new Facilis module is the only
// place that can grow. ChatPanel calls it with the controller's bridge and folder root.
//
// Writes are sequential on purpose: the kernel worker serializes VFS syscalls anyway, so a
// fan-out only floods its queue and makes "which file failed" ambiguous. Failures are
// collected per file — a half-applied patch is reported as such, never retried blindly.

import {
  validatePatch,
  type FilePatch,
  type PatchContext,
  type ValidationResult,
  type WritePolicy,
} from "@facilis.dev/ai";
import { aiWritePolicy } from "@/deploy/current";
import { fetchRevision } from "./manifest-client";

/** The slice of KernelBridge a patch needs. Structural so the unit test stays a plain fake. */
export interface PatchBridge {
  request(
    type: string,
    extra?: Record<string, unknown>,
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<unknown>;
}

export interface ApplyPatchInput {
  bridge: PatchBridge;
  /** Absolute VFS path of the project root (no trailing slash). */
  root: string;
  patches: readonly FilePatch[];
  /** Preview base URL (e.g. http://host/preview/3000). When set, the framework revision
   * is refreshed after a clean write so the caller learns the manifest may have changed. */
  manifestBase?: string;
  signal?: AbortSignal;
  /** Full project context; when present the 17-rule validator runs before any write. */
  context?: PatchContext;
  /** The AIResponse `requires_confirmation` flag, for rule 15. */
  requiresConfirmation?: boolean;
  /** Root files this write may touch (the IDE's AGENTS.md scaffold only). */
  rootFiles?: readonly string[];
  /** Rule 11's writable set for this write. The default is the build's deployment profile
   * ({@link aiWritePolicy}); the override exists for tests that exercise the managed roots. */
  writePolicy?: WritePolicy;
}

export interface ApplyPatchResult {
  ok: boolean;
  validation: ValidationResult;
  /** Project-relative paths, in application order. */
  written: string[];
  deleted: string[];
  /** Framework revision after the write, when manifestBase was given and reachable. */
  revision: string | null;
  /** Per-file failures ("path: reason"). Non-empty means the patch applied partially. */
  errors: string[];
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Join root + relative path without ever doubling a slash. */
function absolutePath(root: string, relative: string): string {
  return root.replace(/\/+$/, "") + "/" + relative.replace(/^\/+/, "");
}

export async function applyPatch(input: ApplyPatchInput): Promise<ApplyPatchResult> {
  const validation = validatePatch(input.patches, {
    ...(input.context === undefined ? {} : { context: input.context }),
    ...(input.requiresConfirmation === undefined
      ? {}
      : { requiresConfirmation: input.requiresConfirmation }),
    ...(input.rootFiles === undefined ? {} : { allowedRootFiles: input.rootFiles }),
    writePolicy: input.writePolicy ?? aiWritePolicy,
  });
  if (!validation.ok) {
    return { ok: false, validation, written: [], deleted: [], revision: null, errors: [] };
  }

  const written: string[] = [];
  const deleted: string[] = [];
  const errors: string[] = [];
  const requestOptions = input.signal ? { signal: input.signal } : undefined;

  for (const patch of input.patches) {
    const abs = absolutePath(input.root, patch.path);
    try {
      if (patch.action === "delete") {
        // force mirrors the Explorer: a path that is already gone is not a failed patch,
        // the desired end state holds.
        // oxlint-disable-next-line no-await-in-loop -- patches apply in order; a fan-out floods the single-threaded kernel queue.
        await input.bridge.request("vv-rm", { path: abs, force: true }, requestOptions);
        deleted.push(patch.path);
      } else {
        // oxlint-disable-next-line no-await-in-loop -- same reason: keep the VFS mutation order deterministic.
        await input.bridge.request(
          "vv-write",
          { path: abs, contents: patch.content ?? "" },
          requestOptions,
        );
        written.push(patch.path);
      }
    } catch (error) {
      errors.push(patch.path + ": " + messageOf(error));
    }
  }

  let revision: string | null = null;
  if (input.manifestBase && errors.length === 0) {
    const current = await fetchRevision(input.manifestBase, { signal: input.signal });
    if (current.ok) revision = current.revision;
  }

  return { ok: errors.length === 0, validation, written, deleted, revision, errors };
}
