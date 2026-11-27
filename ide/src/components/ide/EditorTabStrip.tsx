// The editor tab strip: one labelled tablist with a roving tabindex, arrow/Home/End
// navigation, Enter/Space activation and Delete/Backspace close (issue #214). Split from
// EditorGroup.tsx, which keeps the close queue and the unsaved-changes prompt: the
// controller's closeTab discards unsaved edits, so every close here goes through the
// parent's queue instead of the controller.
import { useEffect, useRef, useState } from "react";
import type { TabKind } from "@/vv/controller";
import { t } from "@/i18n";
import { EditorTabItem } from "./EditorTabItem";
import { tabStopId, tabStripIntent } from "./editor-tabs";

/** A tab the strip should move focus to, plus a sequence so the same id can ask twice. */
export interface TabFocusRequest {
  id: string | null;
  seq: number;
}

export interface EditorTabStripProps {
  openTabs: readonly string[];
  activeTab: string | null;
  previewTab: string | null;
  dirty: readonly string[];
  tabKinds: Readonly<Record<string, TabKind>>;
  focusRequest: TabFocusRequest | null;
  onActivate: (id: string) => void;
  onPin: (id: string) => void;
  onClose: (ids: readonly string[]) => void;
  onReorder: (from: string, to: string, after: boolean) => void;
}

/** Focus a tab and keep it on screen; the strip scrolls horizontally. */
function focusTabElement(el: HTMLDivElement): void {
  el.focus();
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function EditorTabStrip({
  openTabs,
  activeTab,
  previewTab,
  dirty,
  tabKinds,
  focusRequest,
  onActivate,
  onPin,
  onClose,
  onReorder,
}: EditorTabStripProps) {
  // Reordering is strip-wide: the dragged tab and the tab under the pointer, so the
  // drop indicator moves rather than accumulating on every tab it crossed.
  const [dragTab, setDragTab] = useState<string | null>(null);
  const [overTab, setOverTab] = useState<{ rel: string; after: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const tabEls = useRef(new Map<string, HTMLDivElement>());
  const stop = tabStopId(openTabs, activeTab);

  // Keep the active tab on screen. Past ~7 open files the strip overflows, and
  // activating a tab from anywhere but the strip itself (Explorer click, ⌘P, a diff
  // opening) leaves the selected tab scrolled out of sight — the editor changes under
  // you while no visible tab looks active.
  useEffect(() => {
    tabEls.current.get(activeTab ?? "")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab, openTabs.length]);

  // A close (from the strip or a palette command) asks for a focus target; the strip
  // owns the DOM, so it applies the request here.
  const appliedFocus = useRef(0);
  const tabCount = useRef(openTabs.length);
  useEffect(() => {
    tabCount.current = openTabs.length;
  }, [openTabs.length]);
  useEffect(() => {
    if (!focusRequest || focusRequest.seq === appliedFocus.current) return;
    appliedFocus.current = focusRequest.seq;
    const id = focusRequest.id;
    const apply = () => {
      const el = id === null ? undefined : tabEls.current.get(id);
      if (el) {
        focusTabElement(el);
      } else if (tabCount.current === 0) {
        listRef.current?.focus();
      }
    };
    apply();
    // The palette closes its dialog in the same commit and may restore focus itself;
    // re-assert only if that left focus on <body>, never over a surface the user chose.
    const frame = requestAnimationFrame(() => {
      if (document.body === document.activeElement) apply();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  // Closing the last tab, possibly several dialogs after the request was made, leaves
  // nothing else to focus: the tablist itself takes it so the page never falls to <body>.
  const hadTabs = useRef(openTabs.length > 0);
  useEffect(() => {
    const was = hadTabs.current;
    hadTabs.current = openTabs.length > 0;
    if (openTabs.length > 0 || !was) return;
    // The close prompt or a context menu can restore focus after this commit; only
    // re-assert when that leaves the page itself focused.
    const apply = () => {
      if (document.activeElement === null || document.activeElement === document.body) {
        listRef.current?.focus();
      }
    };
    apply();
    const frame = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(frame);
  }, [openTabs.length]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, rel: string) => {
    const intent = tabStripIntent(event);
    if (!intent) return;
    // The close control owns its own Enter/Space; only the tab itself activates or closes.
    if (
      (intent.kind === "activate" || intent.kind === "close") &&
      event.target !== event.currentTarget
    ) {
      return;
    }
    event.preventDefault();
    if (intent.kind === "activate") {
      onActivate(rel);
      return;
    }
    if (intent.kind === "close") {
      onClose([rel]);
      return;
    }
    const count = openTabs.length;
    const from = openTabs.indexOf(rel);
    if (from === -1 || count === 0) return;
    // Arrows and Home/End move AND activate, the automatic-activation tabs pattern: the
    // visible file follows the ring instead of needing a second Enter.
    const target =
      intent.kind === "edge"
        ? openTabs[intent.edge === "first" ? 0 : count - 1]
        : openTabs[(from + intent.delta + count) % count];
    const el = target === undefined ? undefined : tabEls.current.get(target);
    if (target === undefined || el === undefined) return;
    focusTabElement(el);
    onActivate(target);
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={t("editorTabs.label")}
      // Programmatically focusable only: the roving tabindex below is the strip's one
      // stop in the Tab order, and this keeps an emptied strip from leaving focus on body.
      tabIndex={-1}
      className="vv-tabs-scroll flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-chrome outline-none"
    >
      {openTabs.map((rel, i) => (
        <EditorTabItem
          key={rel}
          rel={rel}
          index={i}
          active={rel === activeTab}
          openTabs={openTabs}
          dirty={dirty}
          preview={rel === previewTab}
          tabKind={tabKinds[rel]}
          tabStop={rel === stop}
          dragging={dragTab === rel}
          dropSide={overTab?.rel === rel ? (overTab.after ? "after" : "before") : null}
          onElement={(id, el) => {
            if (el) tabEls.current.set(id, el);
            else tabEls.current.delete(id);
          }}
          onActivate={onActivate}
          onPin={onPin}
          onClose={onClose}
          onKeyDown={onKeyDown}
          onDragStart={setDragTab}
          onDragOver={(id, after) => setOverTab({ rel: id, after })}
          onDrop={(id, from, after) => {
            onReorder(from, id, after);
            setDragTab(null);
            setOverTab(null);
          }}
          onDragEnd={() => {
            setDragTab(null);
            setOverTab(null);
          }}
        />
      ))}
    </div>
  );
}
