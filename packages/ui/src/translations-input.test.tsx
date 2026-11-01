import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TranslationsInput } from "./translations-input.tsx";

function render(extra: Partial<Parameters<typeof TranslationsInput>[0]> = {}): string {
  return renderToStaticMarkup(
    <TranslationsInput
      value={{ en: "Hello", it: "" }}
      onChange={() => undefined}
      locales={["en", "it"]}
      defaultLocale="en"
      availableLocales={["en", "it", "es"]}
      {...extra}
    />,
  );
}

describe("TranslationsInput", () => {
  it("renders one tab per locale with filled/empty indicators and the default marker", () => {
    const html = render();

    expect(html).toContain('class="fc-translations"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Languages"');
    expect(html).toContain('role="tab"');
    expect(html).toContain(">EN<");
    expect(html).toContain(">IT<");
    expect(html).toContain("fc-translations__dot--filled");
    expect(html).toContain("fc-translations__dot--empty");
    expect(html).toContain(">Default<");
    expect(html).toContain('title="No translation yet"');
  });

  it("wires the active editor and Field props", () => {
    const html = render({ id: "title", "aria-describedby": "title-hint", "aria-invalid": true });

    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('value="Hello"');
    expect(html).toContain('id="title"');
    expect(html).toContain('aria-describedby="title-hint"');
    expect(html).toContain('aria-invalid="true"');
  });

  it("offers only locales that are not present yet", () => {
    const html = render();
    expect(html).toContain('aria-label="Add language"');
    expect(html).toContain('value="es"');
    expect(html).not.toContain('value="en"');
    expect(html).not.toContain('value="it"');
  });

  it("keeps the default locale unremovable and offers removal on another locale", () => {
    expect(render()).not.toContain("fc-translations__remove");

    const other = render({ initialLocale: "it" });
    expect(other).toContain("fc-translations__remove");
    expect(other).toContain('aria-label="Remove it"');
    expect(other).toContain('aria-selected="true"');
  });

  it("renders a textarea when multiline", () => {
    expect(render({ multiline: true })).toContain("<textarea");
  });

  it("takes custom labels and a custom remove label", () => {
    const html = render({
      initialLocale: "it",
      labels: {
        addLanguage: "Aggiungi lingua",
        removeLanguage: (locale: string) => "Rimuovi " + locale,
        emptyTranslation: "Nessuna traduzione",
        primary: "Predefinita",
        languagesLabel: "Lingue",
      },
    });

    expect(html).toContain('aria-label="Aggiungi lingua"');
    expect(html).toContain('aria-label="Rimuovi it"');
    expect(html).toContain(">Predefinita<");
    expect(html).toContain('aria-label="Lingue"');
    expect(html).toContain('title="Nessuna traduzione"');
  });

  it("disables the controls when disabled", () => {
    const html = render({ disabled: true });
    expect(html).toContain("disabled");
    expect(html).toContain("fc-translations--disabled");
  });
});
