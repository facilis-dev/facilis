// The template registry is the only place a project kind is defined (D-168): picker order,
// the manifest id ProjectMeta stores and the lazy loader are one record, so a template
// cannot be half-registered (a picker entry without a loader, or an id a reopen cannot
// resolve).

import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import {
  DEFAULT_TEMPLATE_KEY,
  FACILIS_TEMPLATES,
  defaultTemplate,
  templateForCreate,
  templateForStoredId,
  type TemplateKey,
} from "./templates";

describe("template registry", () => {
  it("lists the default first, and the todo template is the default", () => {
    expect(FACILIS_TEMPLATES[0]?.key).toBe(DEFAULT_TEMPLATE_KEY);
    expect(DEFAULT_TEMPLATE_KEY).toBe("todo");
    expect(defaultTemplate().key).toBe("todo");
    // The historical manifest id: existing ProjectMeta rows and app markers use it (D-051).
    expect(defaultTemplate().id).toBe("facilis");
  });

  it("keeps keys and manifest ids unique", () => {
    const keys = FACILIS_TEMPLATES.map((descriptor) => descriptor.key);
    const ids = FACILIS_TEMPLATES.map((descriptor) => descriptor.id);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("registers an i18n label and description for every descriptor", () => {
    for (const descriptor of FACILIS_TEMPLATES) {
      expect(en[descriptor.labelKey], descriptor.key).toBeTruthy();
      expect(en[descriptor.descriptionKey], descriptor.key).toBeTruthy();
    }
  });

  it("loads a template whose manifest is the descriptor's id", async () => {
    const loaded = await Promise.all(
      FACILIS_TEMPLATES.map(async (descriptor) => ({
        descriptor,
        template: await descriptor.load(),
      })),
    );
    for (const { descriptor, template } of loaded) {
      expect(template.manifest.id, descriptor.key).toBe(descriptor.id);
      expect(Object.keys(template.files).length, descriptor.key).toBeGreaterThan(0);
    }
  });

  it("resolves a stored id, with the pre-registry 'facilis' id mapping to todo", () => {
    expect(templateForStoredId("facilis")?.key).toBe("todo");
    expect(templateForStoredId("facilis-showcase")?.key).toBe("showcase");
    expect(templateForStoredId("facilis-starter")?.key).toBe("starter");
    // A row from the removed 55-template catalog (D-051) has no manifest: it opens as an
    // editor and Run drops into a shell.
    expect(templateForStoredId("nextjs")).toBeUndefined();
    expect(templateForStoredId(null)).toBeUndefined();
    expect(templateForStoredId(undefined)).toBeUndefined();
  });

  it("creates the requested template, defaulting when none was chosen", () => {
    expect(templateForCreate(undefined)).toBe(defaultTemplate());
    expect(templateForCreate("showcase").key).toBe("showcase");
    expect(templateForCreate("starter").key).toBe("starter");
    // An unshipped persisted choice is the one case the type cannot express: a row created
    // by another build may name a template this one does not have, and create must not throw.
    expect(templateForCreate("nextjs" as TemplateKey).key).toBe(DEFAULT_TEMPLATE_KEY);
  });
});
