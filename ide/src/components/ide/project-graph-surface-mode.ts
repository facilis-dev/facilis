// The surface's two modes (D-211, issue #187). Lifted out of ProjectGraphSurface so the panel
// can drive the progressive Esc order (drawer -> selection -> overview) and search jumps can
// drill into the node's domain without a hidden second source of truth.

export type ProjectGraphMode =
  { readonly kind: "overview" } | { readonly kind: "detail"; readonly domain: string };
