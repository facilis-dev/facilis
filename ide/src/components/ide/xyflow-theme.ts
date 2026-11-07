// React Flow theme bridge (D-044): the library's own CSS variables mapped to the IDE's
// role tokens, so a canvas follows the active theme block instead of the library's
// light-only defaults. Shared by the commit-graph and project-graph canvases.
export const XYFLOW_THEME_TOKENS =
  "[--xy-edge-stroke:var(--border)] [--xy-edge-stroke-selected:var(--primary)] " +
  "[--xy-handle-background-color:var(--muted-foreground)] " +
  "[--xy-handle-border-color:var(--background)] " +
  "[--xy-attribution-background-color:transparent] " +
  "[--xy-controls-button-background-color:var(--card)] " +
  "[--xy-controls-button-background-color-hover:var(--accent)] " +
  "[--xy-controls-button-color:var(--foreground)] " +
  "[--xy-controls-button-border-color:var(--border)]";
