/**
 * Surface requests (D-226 decision 7): a patch that adds a declaration is not written until
 * the user confirms the capability, its snippet and its reason. The request carries all
 * three, so the IDE's card needs no second analysis and the AI cannot smuggle a capability
 * past the confirmation by wording it differently.
 */
import type { EffectiveState } from "../overlay.ts";
import { normalizeProjectPath } from "../paths.ts";
import type { FilePatch, SurfaceRequest } from "../types.ts";
import type { SurfaceDeclarationFact } from "@facilis.dev/analyze";

function snippetAt(content: string | undefined, line: number): string {
  if (content === undefined) return "";
  const rows = content.split("\n");
  const row = rows[line - 1];
  return row === undefined ? "" : row.trim().slice(0, 240);
}

function request(
  path: string,
  declaration: SurfaceDeclarationFact,
  patches: ReadonlyMap<string, string>,
): SurfaceRequest {
  return {
    path,
    capability: declaration.kind,
    reason: declaration.reason,
    snippet: snippetAt(patches.get(path), declaration.source.line),
    line: declaration.source.line,
  };
}

/** Every declaration a patch set adds, deduplicated by site, in a deterministic order. */
export function surfaceRequests(
  state: EffectiveState,
  patches: readonly FilePatch[],
): SurfaceRequest[] {
  const contents = new Map<string, string>();
  for (const patch of patches) {
    if (patch.action !== "delete" && typeof patch.content === "string") {
      contents.set(normalizeProjectPath(patch.path), patch.content);
    }
  }
  const requests: SurfaceRequest[] = [];
  const seen = new Set<string>();
  const add = (path: string, declaration: SurfaceDeclarationFact): void => {
    const normalized = normalizeProjectPath(path);
    if (!state.patchedPaths.has(normalized)) return;
    const key = normalized + ":" + declaration.kind + ":" + declaration.source.line;
    if (seen.has(key)) return;
    seen.add(key);
    requests.push(request(normalized, declaration, contents));
  };

  for (const route of state.analysis.routes) {
    for (const declaration of route.surface.declarations) add(route.sourceFile, declaration);
  }
  for (const extension of state.analysis.surface.extensions) {
    for (const declaration of extension.surface.declarations) add(extension.file, declaration);
  }
  for (const entry of state.analysis.surface.dynamicCode) {
    for (const declaration of entry.surface.declarations) add(entry.file, declaration);
  }

  return requests.toSorted(
    (left, right) => left.path.localeCompare(right.path) || left.line - right.line,
  );
}
