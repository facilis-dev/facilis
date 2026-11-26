// A Q-code must explain itself (issue #190 follow-up): the badge carries the full review
// question as title and accessible name, in the active locale. ide/ ships no jsdom, so this
// renders to a string like the other UI tests.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import { ProjectGraphQuestionHint } from "./ProjectGraphQuestionHint";

function render(code: "Q3" | "Q5" | "Q17", label: string): string {
  return renderToStaticMarkup(
    <ProjectGraphQuestionHint code={code}>{label}</ProjectGraphQuestionHint>,
  );
}

describe("ProjectGraphQuestionHint", () => {
  initI18n();
  afterEach(() => setLocale("en"));

  it("exposes the question behind the code on hover and to assistive tech", () => {
    const html = render("Q3", "Q3 · Tables and views this page uses");
    const question = t("projectGraph.surface.question.q3");
    expect(question).toContain("Q3");
    expect(html).toContain(question);
    expect(html).toContain('aria-label="' + question + '"');
    expect(html).toContain("Q3 · Tables and views this page uses");
  });

  it("translates the question with the locale", () => {
    setLocale("it");
    const html = render("Q5", "Q5 · Sicurezza");
    const question = t("projectGraph.surface.question.q5");
    expect(question).toContain("Q5");
    expect(question).toMatch(/tabella/i);
    expect(html).toContain(question);
  });

  it("keeps lens Q-codes mapped to the question they answer", () => {
    const html = render("Q17", "Q17 · Unknown");
    expect(html).toContain(t("projectGraph.surface.question.q17"));
  });
});
