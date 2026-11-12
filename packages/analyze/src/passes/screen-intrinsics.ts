/**
 * Which intrinsic JSX elements the page preview draws, and which copy they carry.
 *
 * Sections are the page's layout skeleton and are always drawn; content intrinsics are the
 * copy-bearing blocks and controls that make the schematic page readable (D-170). Layout-only
 * wrappers such as `<div>` are flattened, and a copy-bearing text element with no readable copy
 * is flattened too, so the preview never draws empty boxes for spacing wrappers.
 */

import type { AstNode } from "../ast/node.ts";
import { isContentIntrinsic, isRoleIntrinsic, isSectionIntrinsic } from "./jsx.ts";
import { jsxContentFields, jsxTextFields, type JsxTextFields } from "./jsx-text.ts";

/** What a drawable intrinsic contributes: its copy and whether it spends the content budget. */
export interface IntrinsicPlan {
  /** Content intrinsics have their own node budget and only draw when they carry something. */
  readonly content: boolean;
  readonly fields: JsxTextFields | undefined;
}

/** Classify one intrinsic element, or null when it is flattened into its parent. */
export function planIntrinsic(node: AstNode, name: string): IntrinsicPlan | null {
  const section = isSectionIntrinsic(name);
  if (!section && !isContentIntrinsic(name)) return null;
  const fields = section ? jsxTextFields(node) : jsxContentFields(node, name);
  // A control or media element is a visible block even without copy; a bare span is not.
  if (!section && fields === undefined && !isRoleIntrinsic(name)) return null;
  return { content: !section, fields };
}
