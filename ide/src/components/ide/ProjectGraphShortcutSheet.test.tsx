// The shortcut sheet's rendered contract (issue #68 criterion 6), as static markup (the ide/
// pattern: no jsdom): EVERY shortcut and EVERY palette command appears with its accessible
// name, so the keyboard surface is fully discoverable. The key dispatch itself is tested in
// graph-keys.test.ts; the browser gate proves the live open/close.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import { GRAPH_SHORTCUTS } from "@/facilis/graph-navigation";
import { GRAPH_PALETTE_COMMANDS } from "@/facilis/graph-palette";
import { ProjectGraphShortcutSheet } from "./ProjectGraphShortcutSheet";

function markup(open = true): string {
  return renderToStaticMarkup(
    <ProjectGraphShortcutSheet open={open} commands={GRAPH_PALETTE_COMMANDS} onClose={vi.fn()} />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphShortcutSheet", () => {
  it("renders nothing while closed", () => {
    expect(markup(false)).toBe("");
  });

  it("is a named modal dialog", () => {
    const html = markup();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Keyboard shortcuts");
    expect(html).toContain('data-testid="graph-shortcut-sheet"');
    // The dialog is focusable: on open it takes focus so its Esc handler runs before the graph
    // ladder (one keypress closes one layer).
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('role="dialog"');
  });

  it("lists every shortcut with its key and accessible action name", () => {
    const html = markup();
    for (const shortcut of GRAPH_SHORTCUTS) {
      expect(html).toContain('data-testid="graph-shortcut-' + shortcut.id + '"');
      expect(html).toContain(shortcut.keys);
    }
    expect(html).toContain("Fit to view");
    expect(html).toContain("Reset zoom to 100%");
    expect(html).toContain("Zoom preset 1: compact view");
    expect(html).toContain("Zoom preset 2: full detail");
    expect(html).toContain("Toggle topology / matrix");
    expect(html).toContain("Isolate the selected node&#x27;s context");
    expect(html).toContain("Show this shortcut sheet");
    expect(html).toContain("Open the command palette");
  });

  it("lists every palette command with its accessible name", () => {
    const html = markup();
    for (const command of GRAPH_PALETTE_COMMANDS) {
      expect(html).toContain('data-testid="graph-shortcut-command-' + command.id + '"');
    }
    expect(html).toContain("Isolate edge kind: Route → table");
    expect(html).toContain("Isolate edge kind: View → base");
    expect(html).toContain("Palette commands");
  });

  it("speaks Italian when the locale is it", () => {
    setLocale("it");
    const html = markup();
    expect(html).toContain("Scorciatoie da tastiera");
    expect(html).toContain("Comandi della palette");
    expect(html).toContain("Isola il tipo di arco: Route → tabella");
    expect(html).toContain("Reimposta lo zoom al 100%");
  });
});
