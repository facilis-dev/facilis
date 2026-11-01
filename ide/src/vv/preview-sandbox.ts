// The iframe sandbox for a preview frame (D-063; MANAGED-DEPLOYMENT.md §5).
//
// A managed build serves the preview from a separate origin, so the frame must not be
// same-origin with the IDE: without allow-same-origin it gets an opaque origin, and
// project code cannot read the IDE's localStorage (the AI key), its OPFS or the kernel
// bridge. A same-origin preview (the open profile's default) needs allow-same-origin for
// its own session cookie and storage, so this is per-deployment, never a constant.

/** The open profile's preview: same origin with the IDE, today's behaviour. */
export const SAME_ORIGIN_PREVIEW_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-modals";

/** An isolated preview: same capabilities, minus the IDE's origin. */
export const ISOLATED_PREVIEW_SANDBOX = "allow-scripts allow-forms allow-popups allow-modals";

export function previewSandbox(hasSeparateOrigin: boolean): string {
  return hasSeparateOrigin ? ISOLATED_PREVIEW_SANDBOX : SAME_ORIGIN_PREVIEW_SANDBOX;
}

/** Whether this build serves previews from a separate origin (modes B/C). */
export const hasSeparatePreviewOrigin: boolean = Boolean(
  import.meta.env.VITE_PREVIEW_ORIGIN || import.meta.env.VITE_PREVIEW_WILDCARD_DOMAIN,
);
