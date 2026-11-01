import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TagPicker } from "./tag-picker.tsx";

const OPTIONS = ["React", "Vue", "Svelte", "Astro"];

describe("TagPicker", () => {
  it("renders removable chips and an input", () => {
    const html = renderToStaticMarkup(
      <TagPicker value={["React", "TypeScript"]} onChange={() => undefined} />,
    );

    expect(html).toContain("fc-tagpicker__chip");
    expect(html).toContain("React");
    expect(html).toContain("TypeScript");
    expect(html).toContain('aria-label="Remove React"');
    expect(html).toContain('aria-label="Remove TypeScript"');
    expect(html).toContain('role="combobox"');
  });

  it("shows the placeholder only when there are no chips", () => {
    const html = renderToStaticMarkup(<TagPicker value={[]} onChange={() => undefined} />);
    expect(html).toContain('placeholder="Add a tag…"');
  });

  it("uses a custom remove label function", () => {
    const html = renderToStaticMarkup(
      <TagPicker
        value={["React"]}
        onChange={() => undefined}
        removeLabel={(tag) => "Rimuovi " + tag}
      />,
    );

    expect(html).toContain('aria-label="Rimuovi React"');
  });

  it("lists suggestions that are not already selected", () => {
    const html = renderToStaticMarkup(
      <TagPicker value={["React"]} onChange={() => undefined} options={OPTIONS} />,
    );

    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="Suggestions"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Vue");
    expect(html).toContain("Svelte");
    expect(html).toContain("Astro");
    expect(html).not.toMatch(/<li[^>]*>React<\/li>/);
  });

  it("hides suggestions and disables chips when disabled", () => {
    const html = renderToStaticMarkup(
      <TagPicker value={["React"]} onChange={() => undefined} options={OPTIONS} disabled />,
    );

    expect(html).not.toContain('role="listbox"');
    expect(html).toContain("disabled");
  });

  it("forwards Field wiring props to the input", () => {
    const html = renderToStaticMarkup(
      <TagPicker
        value={[]}
        onChange={() => undefined}
        id="tags"
        aria-describedby="tags-hint"
        aria-invalid
      />,
    );

    expect(html).toContain('id="tags"');
    expect(html).toContain('aria-describedby="tags-hint"');
    expect(html).toContain('aria-invalid="true"');
  });
});
