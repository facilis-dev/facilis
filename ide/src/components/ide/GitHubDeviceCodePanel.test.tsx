// The device code replaces the sign-in button, so it must be announced and hold a
// focusable action (issue #219). Focus movement onto the copy button is a CDP step.
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale, t } from "@/i18n";
import { GitHubDeviceCodePanel } from "./GitHubDeviceCodePanel";

const noop = () => {};

function markup(copied: boolean): string {
  return renderToStaticMarkup(
    <GitHubDeviceCodePanel
      code="ABCD-1234"
      verificationUri="https://github.com/login/device"
      copied={copied}
      onCopy={noop}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("GitHubDeviceCodePanel", () => {
  it("publishes the code inside a status region with a focusable copy action", () => {
    const html = markup(false);
    expect(html).toContain('role="status"');
    expect(html).toContain('data-testid="github-device-code-region"');
    expect(html).toContain('data-testid="github-device-code"');
    expect(html).toContain("ABCD-1234");
    expect(html).toContain('data-testid="github-copy-code"');
    expect(html).toContain(`type="button"`);
    expect(html).toContain(t("github.copyCode"));
    expect(html).toContain(t("github.open"));
  });

  it("reports a completed copy inside the announced region", () => {
    expect(markup(true)).toContain(t("github.copied"));
  });
});
