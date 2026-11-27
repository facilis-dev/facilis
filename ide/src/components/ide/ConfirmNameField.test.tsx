// The destructive dialogs' confirmation field: the message must be the input's accessible
// description, and the input keeps the tab stop while the delete/reset runs.
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale, t } from "@/i18n";
import { ConfirmNameField } from "./ConfirmNameField";

const noop = () => {};

function markup(error: string | null): string {
  return renderToStaticMarkup(
    <ConfirmNameField
      label={t("delete.confirmLabel")}
      value="app"
      placeholder="app"
      error={error}
      onChange={noop}
      onSubmit={noop}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ConfirmNameField", () => {
  it("ties the mismatch message to the input", () => {
    const html = markup("Type app exactly to confirm the delete.");
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Type app exactly to confirm the delete.");
    expect(html).toContain(t("delete.confirmLabel"));
  });

  it("renders no description once the typed name matches", () => {
    const html = markup(null);
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain('aria-invalid="');
  });

  it("keeps the input enabled while the dialog is busy", () => {
    // No disabled attribute on the confirmation input: it is the remaining tab stop.
    const input = /<input[^>]*>/.exec(markup("Type app exactly to confirm the delete."))?.[0] ?? "";
    expect(input).not.toMatch(/\sdisabled[=\s>]/);
  });
});
