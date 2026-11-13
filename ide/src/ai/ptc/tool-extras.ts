// The host-gated tool families (D-111/D-126/D-139/D-181/D-182): each module registers
// handlers only when the host provides its seam, and the router composes them here so
// tools.ts stays under the 300-line limit and gains no dependency on the individual families.

import type { PatchValidationHost } from "../patch-validation";
import { createDependencyToolHandlers, type DependencyToolHost } from "./dependency-tools";
import { createFrameworkToolHandlers, type FrameworkToolHost } from "./framework-tools";
import { createRuntimeToolHandlers, type RuntimeToolHandler } from "./graph-tools";
import { createWriteToolHandlers, type WriteToolHost } from "./write-tools";

/** The router host: the validation seam plus every family's optional seam. */
export type ToolHost = PatchValidationHost & WriteToolHost & DependencyToolHost & FrameworkToolHost;

/** Every family's handlers, merged; a family absent from the host contributes nothing. */
export function createExtraHandlers(host: ToolHost): Readonly<Record<string, RuntimeToolHandler>> {
  return {
    ...createRuntimeToolHandlers(host),
    ...createWriteToolHandlers(host),
    ...createDependencyToolHandlers(host),
    ...createFrameworkToolHandlers(host),
  };
}
