// Static-render tests for graph notes (issue #194): the card renders markdown through the
// notebook renderer, exposes its delete control, and the sr-only surface list mirrors it as a
// button. ide/ ships no jsdom, so components render to strings like the other UI tests.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import type { SurfaceCamera } from "@/facilis/graph-surface/camera.ts";
import type { GraphDomain } from "@/facilis/graph-surface/domains.ts";
import type { GraphNote, ProjectGraphNode } from "@/facilis/graph-types";
import { ProjectGraphNodeList } from "./ProjectGraphNodeList";
import { ProjectGraphNoteCard } from "./ProjectGraphNoteCard";

const CAMERA: SurfaceCamera = { tx: 0, ty: 0, scale: 1 };
const NOTE: GraphNote = {
  id: "note:11111111-1111-4111-8111-111111111111",
  x: 10,
  y: 20,
  text: "# Payment notes\n\nHello **world**",
};

function noteCard(note: GraphNote): string {
  return renderToStaticMarkup(
    <ProjectGraphNoteCard
      note={note}
      editing={false}
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
}

const page: ProjectGraphNode = {
  id: "page:admin",
  kind: "page",
  label: "/admin",
  sourceFile: null,
  position: { x: 0, y: 0 },
  matched: true,
  collapsed: false,
  data: {
    kind: "page",
    pagePath: "/admin",
    pageKind: "page",
    callCount: 0,
    routePaths: [],
    preview: null,
  },
};
const domains: readonly GraphDomain[] = [{ name: "admin", nodeIds: [page.id] }];

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphNoteCard", () => {
  it("renders the note markdown and the delete control", () => {
    const html = noteCard(NOTE);
    expect(html).toContain('data-testid="project-graph-note-card"');
    expect(html).toContain("<h1>Payment notes</h1>");
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain('data-testid="project-graph-note-delete"');
    expect(html).toContain('aria-label="' + t("projectGraph.noteDelete") + '"');
  });

  it("escapes raw html before rendering markdown", () => {
    const html = noteCard({
      ...NOTE,
      text: "<img src=x onerror=alert(1)>",
    });
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });

  it("shows the empty placeholder on a note without text", () => {
    expect(noteCard({ ...NOTE, text: "   " })).toContain(t("projectGraph.noteEmpty"));
  });
});

describe("ProjectGraphNodeList notes group", () => {
  it("mirrors each note as a button named after its first line", () => {
    const html = renderToStaticMarkup(
      <ProjectGraphNodeList
        nodes={[page]}
        domains={domains}
        detailDomain={null}
        notes={[NOTE]}
        onSelectNode={vi.fn()}
        onSelectNote={vi.fn()}
        onOpenDomain={vi.fn()}
      />,
    );
    expect(html).toContain('data-testid="project-graph-note"');
    expect(html).toContain('aria-label="Payment notes"');
    expect(html).toContain(t("projectGraph.surface.a11y.notes"));
  });

  it("omits the notes group when there are no notes", () => {
    const html = renderToStaticMarkup(
      <ProjectGraphNodeList
        nodes={[page]}
        domains={domains}
        detailDomain={null}
        onSelectNode={vi.fn()}
        onOpenDomain={vi.fn()}
      />,
    );
    expect(html).not.toContain('data-testid="project-graph-note"');
    expect(html).not.toContain(t("projectGraph.surface.a11y.notes"));
  });
});
