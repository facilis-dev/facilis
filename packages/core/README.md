# @facilis.dev/core

Facilis framework core: configuration contract, authorized-handler types and manifest shapes.

Part of [Facilis](https://github.com/facilis-dev/facilis), a browser-first low-code framework: the Studio
runs a generated project in a WebContainer where vite dev is the only dev server
and Nitro v3 runs as a Vite plugin. Framework contracts live in
[docs/SPEC.md](https://github.com/facilis-dev/facilis/blob/main/docs/SPEC.md) and architectural decisions in
[docs/DECISIONS.md](https://github.com/facilis-dev/facilis/blob/main/docs/DECISIONS.md).

```sh
npm install @facilis.dev/core
```

The package publishes its TypeScript sources and its compiled dist/; the exports map
of the published manifest points at dist/, so Node and bundlers load JavaScript and
the bundled .d.ts files.

Licensed under the MIT License.
