// Temporary availability gate for the Run and Debug panel (D-206).
//
// The breakpoint debugger instruments only the guest require-loader path, so
// breakpoints in Vite SSR-evaluated backend routes (Nitro runs as a Vite plugin
// inside `vite dev`) never bind — silently, with no unbound feedback. The panel
// is hidden until the vendor-side SSR instrumentation seam lands:
// https://github.com/kele23/vivari/issues/5
//
// Re-enable by flipping this flag; the gates live in ActivityBar (entry button),
// AppShell (sidebar branch) and editor-session (Monaco gutter wiring).
export const DEBUG_PANEL_ENABLED: boolean = false;
