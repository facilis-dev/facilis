// ide/ ships no jsdom: the focus-ring classes are asserted on the static markup of the
// fields (the pattern of PreviewTabClose.test.tsx). Moving focus in a browser is the
// manual `pnpm ide:smoke` step in issue #224.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import type { SurfaceCamera } from "@/facilis/graph-surface/camera.ts";
import type { GraphNote } from "@/facilis/graph-types";
import { PreviewAddressBar } from "./PreviewAddressBar";
import { ProjectGraphNoteCard } from "./ProjectGraphNoteCard";
import { SearchForm } from "./SearchForm";

const CAMERA: SurfaceCamera = { tx: 0, ty: 0, scale: 1 };
const NOTE: GraphNote = {
  id: "note:11111111-1111-4111-8111-111111111111",
  x: 10,
  y: 20,
  text: "Payment notes",
};

function classAttrs(html: string): string[] {
  return [...html.matchAll(/class="([^"]*)"/g)].map((match) => match[1]);
}

function searchForm(): string {
  return renderToStaticMarkup(
    <SearchForm
      query=""
      onQueryChange={vi.fn()}
      matchCase={false}
      wholeWord={false}
      regex={false}
      regexError={null}
      onToggleMatchCase={vi.fn()}
      onToggleWholeWord={vi.fn()}
      onToggleRegex={vi.fn()}
      showReplace
      onToggleReplace={vi.fn()}
      replaceText=""
      onReplaceTextChange={vi.fn()}
      preserveCase={false}
      onTogglePreserveCase={vi.fn()}
      onReplaceAll={vi.fn()}
      canReplaceAll
      showDetails
      onToggleDetails={vi.fn()}
      includeGlob=""
      onIncludeGlobChange={vi.fn()}
      excludeGlob=""
      onExcludeGlobChange={vi.fn()}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("search fields", () => {
  it("puts the ring on the bordered shell, not on the outline-less inner input", () => {
    const html = searchForm();
    const shells = classAttrs(html).filter((className) =>
      className.includes("focus-within:border-ring"),
    );
    expect(shells).toHaveLength(2);
    for (const className of shells) {
      expect(className).toContain("focus-within:ring-3");
      expect(className).toContain("focus-within:ring-ring/50");
    }
    const inner = classAttrs(html).filter(
      (className) => className.includes("outline-none") && className.includes("bg-transparent"),
    );
    expect(inner).toHaveLength(2);
    for (const className of inner) expect(className).toContain("ring-0");
  });

  it("rings the standalone include/exclude glob inputs", () => {
    const globs = classAttrs(searchForm()).filter((className) =>
      className.includes("focus-visible:border-ring"),
    );
    expect(globs).toHaveLength(2);
    for (const className of globs) {
      expect(className).toContain("outline-none");
      expect(className).toContain("focus-visible:ring-3");
      expect(className).toContain("focus-visible:ring-ring/50");
    }
  });

  it("never leaves outline-none without a ring in the same class list", () => {
    for (const className of classAttrs(searchForm())) {
      if (!className.includes("outline-none")) continue;
      expect(className).toMatch(/ring/);
    }
  });
});

describe("graph note editor", () => {
  it("shows the design-system ring while the note textarea is focused", () => {
    const html = renderToStaticMarkup(
      <ProjectGraphNoteCard
        note={NOTE}
        editing
        selected={false}
        cameraRef={{ current: CAMERA }}
        registerRef={() => {}}
        onStartEdit={vi.fn()}
        onCommitEdit={vi.fn()}
        onCloseEditor={vi.fn()}
        onDelete={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    const textarea = html.match(/<textarea[^>]*class="([^"]*)"/)?.[1] ?? "";
    expect(textarea).toContain("outline-none");
    expect(textarea).toContain("focus-visible:border-ring");
    expect(textarea).toContain("focus-visible:ring-3");
    expect(textarea).toContain("focus-visible:ring-ring/50");
  });
});

describe("preview address bar", () => {
  it("rings the shell so the lock mark sits inside the focus state", () => {
    const html = renderToStaticMarkup(
      <PreviewAddressBar url="localhost:3000" onUrlChange={vi.fn()} onNavigate={vi.fn()} />,
    );
    const shell =
      classAttrs(html).find((className) => className.includes("focus-within:border-ring")) ?? "";
    expect(shell).toContain("focus-within:ring-3");
    expect(shell).toContain("focus-within:ring-ring/50");
    const input = classAttrs(html).find((className) => className.includes("outline-none")) ?? "";
    expect(input).toContain("ring-0");
    expect(html).toContain(`aria-label="${t("preview.address")}"`);
  });
});
