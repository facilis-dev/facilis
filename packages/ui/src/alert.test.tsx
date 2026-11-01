import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Alert } from "./alert.tsx";

describe("Alert", () => {
  it("defaults to the info tone with role=status", () => {
    const html = renderToStaticMarkup(<Alert>Heads up</Alert>);
    expect(html).toContain('role="status"');
    expect(html).toContain("fc-alert--info");
  });

  it("uses the assertive role for warning and error", () => {
    expect(renderToStaticMarkup(<Alert tone="warning">Careful</Alert>)).toContain('role="alert"');
    expect(renderToStaticMarkup(<Alert tone="error">Broken</Alert>)).toContain('role="alert"');
  });

  it("uses the polite role for success and keeps an explicit role", () => {
    expect(renderToStaticMarkup(<Alert tone="success">Saved</Alert>)).toContain('role="status"');
    expect(
      renderToStaticMarkup(
        <Alert tone="info" role="none">
          Quiet
        </Alert>,
      ),
    ).toContain('role="none"');
  });
});
