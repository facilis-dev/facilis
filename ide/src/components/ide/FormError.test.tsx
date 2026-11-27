// ide/ ships no jsdom: the association between a field and its error is asserted on the
// static markup (the pattern of SourceControlCommitBox.test.tsx). Moving focus cannot be
// asserted here; that is a browser step in pnpm ide:smoke.
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import { FormError, useFormError } from "./FormError";

function InvalidField() {
  const error = useFormError("Type app exactly to confirm the delete.");
  return (
    <div>
      <input {...error.controlProps} />
      {error.node}
    </div>
  );
}

function ValidField() {
  const error = useFormError(null);
  return (
    <div>
      <input {...error.controlProps} />
      {error.node}
    </div>
  );
}

function describedBy(html: string): string | undefined {
  return /aria-describedby="([^"]+)"/.exec(html)?.[1];
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("useFormError", () => {
  it("points aria-describedby at the rendered message and marks the control invalid", () => {
    const html = renderToStaticMarkup(<InvalidField />);
    const id = describedBy(html);
    expect(id).toBeDefined();
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Type app exactly to confirm the delete.");
  });

  it("does not use a live region for per-keystroke validation", () => {
    expect(renderToStaticMarkup(<InvalidField />)).not.toContain('role="alert"');
  });

  it("leaves a valid field unassociated", () => {
    const html = renderToStaticMarkup(<ValidField />);
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("<p");
  });
});

describe("FormError", () => {
  it("announces asynchronous failures as an alert", () => {
    const html = renderToStaticMarkup(<FormError live>Import failed</FormError>);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Import failed");
  });
});
