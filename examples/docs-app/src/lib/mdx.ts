/**
 * MDX evaluation for the docs pipeline (example-local convention, issue #163).
 *
 * @mdx-js/mdx compiles MDX to a React component. evaluateSync runs the compiler IN THE
 * BROWSER (pure JS, no native binary, no build plugin): the prerender engine's SSR
 * sub-build loads no Vite config (D-202 Arm C), so a build-time plugin like
 * @mdx-js/rollup could not compile content there — runtime evaluation is the one shape
 * that works identically for the client build, the SSR pass and plain vite dev.
 *
 * Compilation is synchronous and cached per source text, so a page compiles once and
 * every later render (including hydration) reuses the same component. Components are
 * supplied by the layout through the standard MDX "components" prop; content does not
 * import modules (the example-local pipeline has no import resolver).
 */

import { evaluateSync } from "@mdx-js/mdx";
import { Fragment, isValidElement, type ComponentType, type ReactNode } from "react";
import { jsx, jsxs } from "react/jsx-runtime";

export interface MdxComponentProps {
  children?: ReactNode;
  [prop: string]: unknown;
}

export type MdxComponents = Record<string, ComponentType<MdxComponentProps>>;

type MdxContent = ComponentType<{ components?: MdxComponents }>;

const cache = new Map<string, MdxContent>();

/** Compile one MDX body to its component, at most once per source text. */
export function compileMdx(body: string): MdxContent {
  const hit = cache.get(body);
  if (hit !== undefined) return hit;
  const compiled = evaluateSync(body, { Fragment, jsx, jsxs });
  const Content = compiled.default as MdxContent;
  cache.set(body, Content);
  return Content;
}

/** The plain text of a React node — how MDX headings derive the same ids as the TOC. */
export function mdxPlainText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(mdxPlainText).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return mdxPlainText(props.children);
  }
  return "";
}
