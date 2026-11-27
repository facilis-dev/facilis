// ide/ ships no jsdom: the commit box's labels and disabled states are rendered to a static
// string with react-dom/server (the pattern of RecentProjectsRow.test.tsx). Behaviour
// (abort/latest/failure) is covered by commit-box-state.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale, t } from "@/i18n";
import type { RepoState } from "@/vv/scm-session";
import type { CommitBoxSnapshot } from "./commit-box-state";
import { CommitBoxView } from "./SourceControlCommitBox";
import { formatChord } from "./shortcuts";

function repo(overrides: Partial<RepoState> = {}): RepoState {
  return {
    root: "/w/app",
    name: "app",
    isRepo: true,
    checking: false,
    busy: false,
    currentBranch: "main",
    branches: ["main"],
    staged: [],
    changes: [{ path: "src/app.ts", abs: "/w/app/src/app.ts", letter: "M" }],
    history: [],
    commitMessage: "",
    error: null,
    ...overrides,
  };
}

const idle: CommitBoxSnapshot = { running: false, error: null, pending: null };

function markup(
  state: RepoState = repo(),
  configured = true,
  box: CommitBoxSnapshot = idle,
): string {
  return renderToStaticMarkup(
    <CommitBoxView
      repo={state}
      configured={configured}
      box={box}
      onChange={vi.fn()}
      onCommit={vi.fn()}
      onGenerate={vi.fn()}
      onConfirm={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("CommitBoxView", () => {
  it("renders the localized labels and an enabled generate control", () => {
    const html = markup();
    expect(html).toContain(t("scm.generate"));
    expect(html).toContain(t("scm.commit"));
    expect(html).toContain(`aria-label="${t("scm.generate")}"`);
    // The hint is the platform's chord, not a literal (issue #222): Node has no
    // navigator, so the formatter takes its non-macOS spelling here.
    expect(html).toContain(
      "Message (" + formatChord({ key: "Enter", mod: true }) + " to commit on",
    );
    // Only Commit is disabled: the box is empty but the model is configured.
    expect(html.match(/\sdisabled=""/g)).toHaveLength(1);
  });

  it("disables generate without a configured model", () => {
    const html = markup(repo(), false);
    expect(html.match(/\sdisabled=""/g)).toHaveLength(2);
  });

  it("disables generate while generating, and shows the busy label only there", () => {
    const html = markup(repo(), true, { running: true, error: null, pending: null });
    expect(html).toContain(t("scm.generating"));
    expect(html).not.toContain(`>${t("scm.generate")}<`);
    expect(html).toContain("animate-spin");
    expect(html.match(/\sdisabled=""/g)).toHaveLength(2);
  });

  it("disables generate when there is nothing to describe", () => {
    const html = markup(repo({ changes: [] }));
    expect(html.match(/\sdisabled=""/g)).toHaveLength(2);
  });

  it("surfaces a failure inline", () => {
    const html = markup(repo(), true, {
      running: false,
      error: { reason: "failed", message: "offline" },
      pending: null,
    });
    expect(html).toContain(t("scm.generate.failed"));
  });

  it("shows the confirmation instead of replacing the user's text", () => {
    const html = markup(repo({ commitMessage: "mine" }), true, {
      running: false,
      error: null,
      pending: "feat: generated",
    });
    expect(html).toContain(t("scm.generate.confirm"));
    expect(html).toContain(t("scm.generate.replace"));
    expect(html).toContain(t("scm.generate.keep"));
    expect(html).toContain("feat: generated");
    expect(html).toContain("mine");
  });

  it("keeps Commit enabled when the box already has text", () => {
    const html = markup(repo({ commitMessage: "mine" }));
    expect(html.match(/\sdisabled=""/g)).toBeNull();
  });
});
