// The command-palette and lens-picker catalogue (issue #204), derived from the ONE lens
// registry (#198): adding a lens makes it appear here with no palette change. Both surfaces
// run the same intent — open the graph tab, then ask the panel to toggle the lens — so the
// bar's lifecycle stays the only implementation (D-224).

import { t } from "@/i18n";
import {
  LENS_AVAILABLE,
  type GraphLensAvailability,
} from "@/facilis/graph-surface/lens-lifecycle.ts";
import type { GraphLensDefinition, GraphLensId } from "@/facilis/graph-surface/lenses.ts";
import { GRAPH_LENSES } from "@/facilis/graph-surface/lenses-registry.ts";
import { requestGraphLens } from "@/facilis/graph-surface/lens-request.ts";
import {
  runtimeLensAvailability,
  type RuntimeLensController,
} from "@/facilis/graph-surface/runtime-lens-source.ts";

/** The one chord: a picker with a digit per lens, so no per-lens browser binding is needed. */
export const LENS_PICKER_CHORD = "⌘⇧L";

/** The controller slice a lens command needs: the same runtime source plus the graph tab. */
export interface GraphLensCommandController extends RuntimeLensController {
  openProjectGraph(): void;
}

export interface GraphLensCommand {
  readonly lens: GraphLensId;
  /** 1-based position in the registry, the picker's digit. */
  readonly index: number;
  readonly title: string;
  readonly description: string;
  /** The palette label ("Lens: Q5 · Security"). */
  readonly label: string;
  /** The chord plus the picker digit ("⌘⇧L 1"). */
  readonly keys: string;
  readonly disabled: boolean;
  /** The translated availability reason; null when the lens can run. */
  readonly reason: string | null;
  readonly run: () => void;
}

function availabilityOf(
  definition: GraphLensDefinition,
  controller: GraphLensCommandController,
  dev: boolean,
): GraphLensAvailability {
  return definition.source === "live" ? runtimeLensAvailability(controller, dev) : LENS_AVAILABLE;
}

/** One command per registry lens, in registry order; `definitions` is injectable for tests. */
export function graphLensCommands(
  controller: GraphLensCommandController,
  dev: boolean = import.meta.env.DEV,
  definitions: readonly GraphLensDefinition[] = GRAPH_LENSES,
): readonly GraphLensCommand[] {
  return definitions.map((definition, position) => {
    const availability = availabilityOf(definition, controller, dev);
    const title = t(definition.titleKey);
    return {
      lens: definition.id,
      index: position + 1,
      title,
      description: t(definition.descriptionKey),
      label: t("palette.lens", { lens: title }),
      keys: LENS_PICKER_CHORD + " " + (position + 1),
      disabled: !availability.available,
      reason: availability.reasonKey === null ? null : t(availability.reasonKey),
      run: () => {
        controller.openProjectGraph();
        requestGraphLens(definition.id);
      },
    };
  });
}

/** The global chord: Ctrl/Cmd+Shift+L, no Alt, never a plain shortcut. */
export function isLensPickerChord(event: {
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly key: string;
}): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "l"
  );
}

/** The structural slice of a focused element the guard reads (testable without a DOM). */
export interface LensFocusTarget {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

const TYPING_SELECTOR = ".monaco-editor, .vv-term-host, [contenteditable='true'], [role='textbox']";

/**
 * Focus safety: the chord belongs to the caret while an input, textarea, select, Monaco
 * editor or terminal has it, so the global handler must not consume it there.
 */
export function isLensChordBlocked(target: LensFocusTarget | null): boolean {
  if (target === null) return false;
  if (target.isContentEditable === true) return true;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
    return true;
  }
  return typeof target.closest === "function" && target.closest(TYPING_SELECTOR) !== null;
}
