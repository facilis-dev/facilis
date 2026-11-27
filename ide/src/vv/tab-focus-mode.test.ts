// The Tab-moves-focus store and its words (issue #210). The flag lives inside Monaco with no
// public getter, so this is the IDE's own record of it: the action flips it, the store records
// it, and the palette label plus the live region speak it. A DOM-free unit test, because the
// IDE ships no jsdom — the focus movement itself is a pnpm ide:smoke step.

import { beforeEach, describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { it as itMessages } from "@/i18n/it";
import { initI18n, setLocale } from "@/i18n";
import {
  TAB_FOCUS_ACTION,
  tabFocusMode,
  tabFocusModeLabel,
  toggleTabFocusMode,
} from "./tab-focus-mode";

beforeEach(() => {
  initI18n();
  setLocale("en");
  tabFocusMode.set(false);
});

describe("the tab-focus store", () => {
  it("toggles through Monaco's action and notifies subscribers once per change", () => {
    const actions: string[] = [];
    let updates = 0;
    const unsubscribe = tabFocusMode.subscribe(() => {
      updates += 1;
    });

    toggleTabFocusMode({ runEditorAction: (id) => actions.push(id) });
    expect(actions).toEqual([TAB_FOCUS_ACTION]);
    expect(tabFocusMode.getSnapshot()).toBe(true);
    expect(updates).toBe(1);

    toggleTabFocusMode({ runEditorAction: (id) => actions.push(id) });
    expect(tabFocusMode.getSnapshot()).toBe(false);
    expect(updates).toBe(2);

    unsubscribe();
    toggleTabFocusMode({ runEditorAction: (id) => actions.push(id) });
    expect(updates).toBe(2);
  });

  it("stays quiet when the state it is told about has not changed", () => {
    let updates = 0;
    tabFocusMode.subscribe(() => {
      updates += 1;
    });
    tabFocusMode.set(false);
    expect(updates).toBe(0);
    tabFocusMode.set(true);
    tabFocusMode.set(true);
    expect(updates).toBe(1);
  });
});

describe("the tab-focus words", () => {
  it("labels the state, and the announcement is that same label", () => {
    expect(tabFocusModeLabel(false)).toBe(en["a11y.tabFocus.off"]);
    expect(tabFocusModeLabel(true)).toBe(en["a11y.tabFocus.on"]);
  });

  it("says it in Italian too, so the announcement is not English-only", () => {
    expect(itMessages["a11y.tabFocus.off"]).toBeTruthy();
    expect(itMessages["a11y.tabFocus.on"]).toBeTruthy();
  });
});
