// Static-render tests for the keyboard-shortcuts help (issue #223): every registry label is
// listed with its registry chord, the browser-reserved ones carry their reason, and the footer
// names the bindings the registry deliberately does not model. Real focus movement and Escape
// need a DOM, so those stay a manual/CDP check (pnpm ide:smoke).

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import { SHORTCUTS, formatShortcut } from "./shortcuts";
import { ShortcutHelpDialog } from "./ShortcutHelpDialog";

beforeEach(() => {
  initI18n();
  setLocale("en");
});

const render = () => renderToStaticMarkup(<ShortcutHelpDialog open onClose={vi.fn()} />);

// renderToStaticMarkup escapes apostrophes, so compare the copy in its HTML spelling.
const escaped = (text: string) => text.replaceAll("'", "&#x27;");

describe("ShortcutHelpDialog", () => {
  it("lists every registry label with its platform chord", () => {
    const html = render();
    expect(html).toContain(t("shortcuts.dialogTitle"));
    for (const entry of SHORTCUTS) {
      expect(html).toContain(t(entry.labelKey, entry.labelParams));
      expect(html).toContain(formatShortcut(entry.id));
    }
  });

  it("groups by context and marks the browser-reserved chords", () => {
    const html = render();
    expect(html).toContain(t("shortcuts.group.global"));
    expect(html).toContain(t("shortcuts.group.browser"));
    expect(html).toContain(t("shortcuts.closeTab"));
    expect(html).toContain(t("shortcuts.note.browserKeeps"));
  });

  it("lists the terminal escape chord under the global bindings", () => {
    const html = render();
    const global = html.slice(
      html.indexOf('id="shortcut-help-global"'),
      html.indexOf('id="shortcut-help-editor"'),
    );
    expect(global).toContain(t("shortcuts.focusTerminal"));
    expect(global).toContain(formatShortcut("terminal-focus"));
    expect(global).toContain(t("shortcuts.note.terminalFocus"));
  });

  it("says the tour keeps Escape and the arrows while it is open", () => {
    const html = render();
    expect(html).toContain(t("shortcuts.tourDismiss"));
    expect(html).toContain(t("shortcuts.tourNext"));
    expect(html).toContain(t("shortcuts.tourPrevious"));
    expect(html).toContain(t("shortcuts.note.tourKeeps"));
  });

  it("says what it does not cover: Escape ladders, Monaco and xterm", () => {
    const html = render();
    expect(html).toContain(t("shortcuts.notInRegistry.title"));
    expect(html).toContain(escaped(t("shortcuts.notInRegistry.escape")));
    expect(html).toContain(escaped(t("shortcuts.notInRegistry.editors")));
  });

  it("renders nothing while closed", () => {
    expect(renderToStaticMarkup(<ShortcutHelpDialog open={false} onClose={vi.fn()} />)).toBe("");
  });
});
