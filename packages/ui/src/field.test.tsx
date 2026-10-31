import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field } from "./field.tsx";
import { Input } from "./input.tsx";

function element(html: string, tag: string): string {
  const match = new RegExp("<" + tag + "[^>]*>").exec(html);
  if (match === null || match[0] === undefined) {
    throw new Error("missing <" + tag + "> in: " + html);
  }
  return match[0];
}

function attribute(html: string, tag: string, name: string): string {
  const match = new RegExp(name + '="([^"]*)"').exec(element(html, tag));
  if (match === null || match[1] === undefined) {
    throw new Error("missing " + name + " on <" + tag + "> in: " + html);
  }
  return match[1];
}

function hasAttribute(html: string, tag: string, name: string): boolean {
  return new RegExp(name + '="').test(element(html, tag));
}

function paragraphId(html: string, className: string): string {
  const match = new RegExp('<p class="' + className + '" id="([^"]+)"').exec(html);
  if (match === null || match[1] === undefined) {
    throw new Error("missing paragraph " + className + " in: " + html);
  }
  return match[1];
}

describe("Field", () => {
  it("wires the label, hint and error to the control", () => {
    const html = renderToStaticMarkup(
      <Field label="Email" hint="We never share it." error="Enter an email." className="extra">
        <Input name="email" />
      </Field>,
    );

    const controlId = attribute(html, "input", "id");
    expect(attribute(html, "label", "for")).toBe(controlId);
    expect(attribute(html, "input", "aria-invalid")).toBe("true");

    const describedBy = attribute(html, "input", "aria-describedby").split(" ");
    expect(describedBy).toContain(paragraphId(html, "fc-field__hint"));
    expect(describedBy).toContain(paragraphId(html, "fc-field__error"));

    expect(html).toContain(">Email<");
    expect(html).toContain("We never share it.");
    expect(html).toContain("Enter an email.");
    expect(html).toContain('class="fc-field extra"');
  });

  it("lets an explicit control prop win", () => {
    const html = renderToStaticMarkup(
      <Field label="Email" error="Enter an email.">
        <Input id="custom-id" aria-describedby="external" aria-invalid={false} />
      </Field>,
    );

    expect(attribute(html, "input", "id")).toBe("custom-id");
    expect(attribute(html, "label", "for")).toBe("custom-id");
    expect(attribute(html, "input", "aria-invalid")).toBe("false");

    const describedBy = attribute(html, "input", "aria-describedby").split(" ");
    expect(describedBy[0]).toBe("external");
    expect(describedBy).toContain(paragraphId(html, "fc-field__error"));
  });

  it("adds no description or invalid state when there is neither hint nor error", () => {
    const html = renderToStaticMarkup(
      <Field label="Name">
        <Input />
      </Field>,
    );

    expect(hasAttribute(html, "input", "aria-describedby")).toBe(false);
    expect(hasAttribute(html, "input", "aria-invalid")).toBe(false);
    expect(html).not.toContain("fc-field__hint");
    expect(html).not.toContain("fc-field__error");
  });
});
