import { useState } from "react";
import { Field, Markdown, MarkdownEditor, TranslationsInput, type Translations } from "@facilis/ui";
import { Section } from "./section.tsx";

const SAMPLE = [
  "## Release notes",
  "",
  "This release brings **faster tables** and *quieter* notifications.",
  "",
  "- Dense rows respect the 44px rhythm",
  "- Toasts dismiss after four seconds",
  "",
  "> Calm tools, clear handoffs.",
  "",
  "[Read the full changelog](https://example.com/changelog)",
].join("\n");

export function ContentSection() {
  const [markdown, setMarkdown] = useState(SAMPLE);
  const [title, setTitle] = useState<Translations>({
    en: "Welcome to Northwind",
    it: "Benvenuti in Northwind",
    es: "",
  });
  const [notification, setNotification] = useState<Translations>({
    en: "Your workspace is ready.",
    it: "Il tuo spazio di lavoro è pronto.",
    es: "",
  });

  return (
    <Section
      id="content"
      title="Content"
      description="Long-form text uses the Markdown editor with a safe preview; translatable text manages one value per locale without a server dependency."
    >
      <div className="gallery-grid">
        <Field label="Page body" hint="Markdown: toolbar writes the syntax, Preview renders it.">
          <MarkdownEditor value={markdown} onChange={setMarkdown} rows={10} />
        </Field>

        <div className="gallery-stack">
          <p className="gallery-panel__title">Rendered preview</p>
          <div className="gallery-panel">
            <Markdown source={markdown} />
          </div>
        </div>
      </div>

      <div className="gallery-grid">
        <Field label="Page title" hint="One value per locale; the default tab cannot be removed.">
          <TranslationsInput
            value={title}
            onChange={setTitle}
            locales={["en", "it"]}
            availableLocales={["en", "it", "es"]}
            defaultLocale="en"
          />
        </Field>

        <Field label="Notification body" hint="The same value shape with a multiline editor.">
          <TranslationsInput
            value={notification}
            onChange={setNotification}
            locales={["en", "it"]}
            availableLocales={["en", "it", "es"]}
            defaultLocale="en"
            multiline
          />
        </Field>
      </div>
    </Section>
  );
}
