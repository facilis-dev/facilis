import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Combobox } from "./combobox.tsx";

const OPTIONS = [
  { value: "northwind", label: "Northwind Studio", hint: "Workspace" },
  { value: "atlas", label: "Atlas Labs" },
] as const;

describe("Combobox", () => {
  it("renders a closed combobox with the placeholder", () => {
    const html = renderToStaticMarkup(
      <Combobox options={OPTIONS} value={null} onChange={() => undefined} />,
    );

    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('placeholder="Select…"');
    expect(html).not.toContain('role="listbox"');
  });

  it("shows the selected label and the clear button", () => {
    const html = renderToStaticMarkup(
      <Combobox
        options={OPTIONS}
        value="atlas"
        onChange={() => undefined}
        clearLabel="Clear selection"
      />,
    );

    expect(html).toContain('value="Atlas Labs"');
    expect(html).toContain('aria-label="Clear selection"');
  });

  it("renders the listbox when open with active option and hints", () => {
    const html = renderToStaticMarkup(
      <Combobox options={OPTIONS} value="atlas" onChange={() => undefined} defaultOpen />,
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="option"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain("aria-activedescendant");
    expect(html).toContain("Workspace");
    expect(html).toContain("aria-controls");
  });

  it("renders the empty state and forwards Field wiring", () => {
    const html = renderToStaticMarkup(
      <Combobox
        options={[]}
        value={null}
        onChange={() => undefined}
        defaultOpen
        emptyLabel="Nessun risultato"
        id="owner"
        aria-describedby="owner-hint"
        aria-invalid
      />,
    );

    expect(html).toContain("Nessun risultato");
    expect(html).toContain('id="owner"');
    expect(html).toContain('aria-describedby="owner-hint"');
    expect(html).toContain('aria-invalid="true"');
  });

  it("disables the input and hides the clear button when disabled", () => {
    const html = renderToStaticMarkup(
      <Combobox options={OPTIONS} value="atlas" onChange={() => undefined} disabled />,
    );

    expect(html).toContain("disabled");
    expect(html).not.toContain("fc-combobox__clear");
  });
});
