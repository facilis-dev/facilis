import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "./toaster.tsx";
import { pushToast } from "./toaster-store.ts";

describe("Toaster", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the fixed region even when the store is empty", () => {
    expect(renderToStaticMarkup(<Toaster />)).toBe('<div class="fc-toaster"></div>');
  });

  it("renders queued toasts with their tone class and role", () => {
    vi.useFakeTimers();
    pushToast("warning", "Quota almost reached");
    pushToast("success", "Saved");

    const html = renderToStaticMarkup(<Toaster />);
    expect(html).toContain('class="fc-toast fc-toast--warning"');
    expect(html).toContain("Quota almost reached");
    expect(html).toContain('role="alert"');
    expect(html).toContain('class="fc-toast fc-toast--success"');
    expect(html).toContain('role="status"');

    vi.advanceTimersByTime(4_000);
    expect(renderToStaticMarkup(<Toaster />)).toBe('<div class="fc-toaster"></div>');
  });
});
