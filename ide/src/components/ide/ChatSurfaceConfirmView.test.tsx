// Static-render tests for the declared-capability card (D-226, #234): every request shows its
// capability, its exact site and snippet, and an editable reason prefilled with the generated
// one — the user must be able to judge the declaration before it lands.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { SurfaceRequest } from "@facilis.dev/ai";

import { initI18n, setLocale, t } from "@/i18n";
import type { ChatSession } from "@/ai/chat-session";
import type { ChatState } from "@/ai/types";
import { ChatSurfaceConfirmView } from "./ChatSurfaceConfirmView";

const REQUESTS: readonly SurfaceRequest[] = [
  {
    path: "server/routes/hook.post.ts",
    capability: "raw-route",
    reason: "signed webhook endpoint",
    snippet: "export default defineRawRoute({",
    line: 4,
  },
  {
    path: "src/formula.ts",
    capability: "dynamic-code",
    reason: "evaluates a user formula",
    snippet: "// dynamic-code: evaluates a user formula",
    line: 1,
  },
];

/** Only surfaceConfirm is read; the actions are never called by this static render. */
const chat = {
  surfaceConfirm: { confirm: vi.fn(), cancel: vi.fn() },
} as unknown as ChatSession;

function render(requests: readonly SurfaceRequest[] | null): string {
  const state = { surfaceConfirm: requests } as ChatState;
  return renderToStaticMarkup(<ChatSurfaceConfirmView chat={chat} state={state} />);
}

beforeAll(() => {
  initI18n();
  setLocale("en");
});

describe("ChatSurfaceConfirmView", () => {
  it("lists each declaration with its capability, site, snippet and reason", () => {
    const html = render(REQUESTS);
    expect(html).toContain(t("chat.surfaceConfirm.title"));
    expect(html).toContain(t("chat.surfaceConfirm.capability.rawRoute"));
    expect(html).toContain(t("chat.surfaceConfirm.capability.dynamicCode"));
    expect(html).toContain("server/routes/hook.post.ts:4");
    expect(html).toContain("src/formula.ts:1");
    expect(html).toContain("export default defineRawRoute({");
    expect(html).toContain("// dynamic-code: evaluates a user formula");
    expect(html).toContain('value="signed webhook endpoint"');
    expect(html).toContain('value="evaluates a user formula"');
    expect(html).toContain(t("chat.surfaceConfirm.confirm"));
    expect(html).toContain(t("chat.surfaceConfirm.cancel"));
  });

  it("renders nothing without a pending declaration", () => {
    expect(render(null)).toBe("");
  });
});
