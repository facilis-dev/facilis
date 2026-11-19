// The IDE ships no jsdom: the footer's presentational half is rendered to a static string
// with react-dom/server (the pattern of RecentProjectsRow.test.tsx), so the disclosure
// wiring, the row list and the collapsed header can be asserted without the IDE context.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale, t } from "@/i18n";
import type { ChatTurnWrite } from "@/ai/types";
import { ChatGitChangesFooterView, type ChatGitChangeRow } from "./ChatGitChangesView";

const LIST_ID = "chat-git-changes-list";

function write(path: string, destructive = false): ChatTurnWrite {
  return { path, action: "update", destructive, added: 3, removed: 1 };
}

/** Alternating rows: half carry a turn write (line counts), half are SCM-only changes. */
function rows(count: number, destructive = false): ChatGitChangeRow[] {
  return Array.from({ length: count }, (_, index) => {
    const path = `src/file-${String(index + 1).padStart(2, "0")}.ts`;
    return index % 2 === 0
      ? { path, letter: "M", write: write(path, destructive && index === 0) }
      : { path, letter: "A" };
  });
}

function markup({
  expanded = true,
  count = 12,
  destructive = false,
  canUndo = true,
  undoing = false,
}: {
  expanded?: boolean;
  count?: number;
  destructive?: boolean;
  canUndo?: boolean;
  undoing?: boolean;
} = {}): string {
  return renderToStaticMarkup(
    <ChatGitChangesFooterView
      changes={rows(count, destructive)}
      expanded={expanded}
      canUndo={canUndo}
      undoing={undoing}
      onToggle={vi.fn()}
      onOpenScm={vi.fn()}
      onUndo={vi.fn()}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ChatGitChangesFooterView", () => {
  it("is expanded by default and lists every changed file", () => {
    const html = markup();
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(`aria-controls="${LIST_ID}"`);
    expect(html).toContain(`id="${LIST_ID}"`);
    expect(html.match(/<li /g)).toHaveLength(12);
    expect(html).toContain("src/file-12.ts");
    expect(html).toContain(t("chat.git.title", { n: 12 }));
    // The whole list scrolls inside a viewport-aware height; nothing is truncated to six.
    expect(html).toContain("max-h-[min(40vh,16rem)]");
    expect(html).not.toMatch(/more file/);
    expect(html).not.toMatch(/<ul[^>]*\bhidden\b/);
  });

  it("collapses to the header alone and keeps the list addressable", () => {
    const html = markup({ expanded: false });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`aria-controls="${LIST_ID}"`);
    expect(html).toContain(`aria-label="${t("chat.git.expand")}"`);
    expect(html).toContain(t("chat.git.title", { n: 12 }));
    // The list stays in the DOM so aria-controls resolves, but it is hidden.
    expect(html).toMatch(/<ul[^>]*\bhidden\b/);
    expect(html).toContain(`id="${LIST_ID}"`);
  });

  it("uses the collapse label and a rotated chevron while expanded", () => {
    const expanded = markup();
    const collapsed = markup({ expanded: false });
    expect(expanded).toContain(`aria-label="${t("chat.git.collapse")}"`);
    expect(expanded).not.toContain("-rotate-90");
    expect(collapsed).toContain("-rotate-90");
  });

  it("keeps a destructive write visible when collapsed", () => {
    expect(markup({ expanded: false, destructive: true })).toContain(
      `aria-label="${t("chat.git.destructive")}"`,
    );
    expect(markup({ expanded: false })).not.toContain(`aria-label="${t("chat.git.destructive")}"`);
    // Expanded, the row badge already carries the warning: no duplicate header marker.
    expect(markup({ destructive: true })).not.toContain(
      `aria-label="${t("chat.git.destructive")}"`,
    );
  });

  it("keeps Source Control and Undo as sibling buttons, not nested in the toggle", () => {
    const html = markup();
    const toggle = html.slice(0, html.indexOf("</button>"));
    expect(toggle.match(/<button/g)).toHaveLength(1);
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain(t("chat.git.open"));
    expect(html).toContain(t("chat.git.undo"));
    // The toggle is keyboard reachable and shows focus when it has it.
    expect(toggle).toContain('type="button"');
    expect(toggle).toContain("focus-visible:ring-2");
  });

  it("drops the Undo button when the turn has no writes, and shows its busy label", () => {
    expect(markup({ canUndo: false })).not.toContain(t("chat.git.undo"));
    expect(markup({ canUndo: false }).match(/<button/g)).toHaveLength(2);
    const busy = markup({ undoing: true });
    expect(busy).toContain(t("chat.git.undoing"));
    expect(busy).toContain('disabled=""');
  });
});
