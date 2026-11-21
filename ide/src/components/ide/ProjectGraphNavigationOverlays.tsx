// The navigation overlays' composition (issue #68): the palette and the shortcut sheet,
// rendered over the canvas but OUTSIDE the HUD so zen mode hides the HUD chrome without
// hiding the keyboard's reach — Cmd/Ctrl+K and "?" still open their dialogs in zen (epic #56
// rule 6). Extracted from ProjectGraphPanel so the composition root stays under the limit.

import { ProjectGraphPalette } from "./ProjectGraphPalette";
import { ProjectGraphShortcutSheet } from "./ProjectGraphShortcutSheet";
import type { ProjectGraphNavigation } from "./useProjectGraphNavigation";

export function ProjectGraphNavigationOverlays({
  navigation,
}: {
  navigation: ProjectGraphNavigation;
}) {
  return (
    <>
      <ProjectGraphPalette
        open={navigation.paletteOpen}
        index={navigation.paletteIndex}
        onClose={navigation.closePalette}
        onZoomToNode={navigation.zoomToNode}
        onRunCommand={navigation.runCommand}
      />
      <ProjectGraphShortcutSheet
        open={navigation.sheetOpen}
        commands={navigation.commands}
        onClose={navigation.closeSheet}
      />
    </>
  );
}
