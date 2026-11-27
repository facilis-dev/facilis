// The token field's validation error must reach assistive technology through the input,
// not sit next to it as plain text (issue #219). Static markup only: ide/ ships no jsdom.
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale, t } from "@/i18n";
import { PushRemoteFields, type PushRemoteFieldsProps } from "./PushRemoteFields";

const noop = () => {};

function props(overrides: Partial<PushRemoteFieldsProps> = {}): PushRemoteFieldsProps {
  return {
    repository: "owner/repo",
    token: "not-a-token",
    tokenInvalid: true,
    createBranch: false,
    branch: "main",
    message: "Update from facilis.dev",
    authorName: "Ada",
    authorEmail: "ada@example.com",
    busy: false,
    onRepository: noop,
    onToken: noop,
    onCreateBranch: noop,
    onBranch: noop,
    onMessage: noop,
    onAuthorName: noop,
    onAuthorEmail: noop,
    ...overrides,
  };
}

function tokenInput(html: string): string {
  return /<input[^>]*type="password"[^>]*>/.exec(html)?.[0] ?? "";
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("PushRemoteFields", () => {
  it("ties the invalid token message to the token input", () => {
    const html = renderToStaticMarkup(<PushRemoteFields {...props()} />);
    const input = tokenInput(html);
    const id = /aria-describedby="([^"]+)"/.exec(input)?.[1];
    expect(id).toBeDefined();
    expect(input).toContain('aria-invalid="true"');
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain(t("push.tokenInvalid"));
    expect(html).not.toContain('role="alert"');
  });

  it("leaves a valid token unassociated", () => {
    const html = renderToStaticMarkup(<PushRemoteFields {...props({ tokenInvalid: false })} />);
    expect(tokenInput(html)).not.toContain("aria-describedby");
    expect(tokenInput(html)).not.toContain('aria-invalid="');
    expect(html).not.toContain(t("push.tokenInvalid"));
  });
});
