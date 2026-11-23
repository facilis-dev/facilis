/// <reference types="vite/client" />

// Nitro's Vite asset queries (official vite-ssr-react example pattern).
declare module "*?assets=client" {
  const assets: {
    entry: string;
    css: { href: string }[];
    js: { href: string }[];
    merge(other: unknown): { entry: string; css: { href: string }[]; js: { href: string }[] };
  };
  export default assets;
}
declare module "*?assets=ssr" {
  const assets: { css: { href: string }[]; js: { href: string }[] };
  export default assets;
}
