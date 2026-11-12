// The template registry (D-168): every project kind the IDE can create, in picker order.
//
// Each descriptor owns its identity (key for the picker, manifest id for ProjectMeta and
// the kernel), its i18n keys and its lazy module loader. Adding a template is one
// descriptor here plus its example-backed module.
//
// The admission marker (.facilis/facilis.app.json) keeps template:"facilis" for every
// variant (app-manifest.ts): admission asks only "is this a Facilis project", never which
// kind it is.

import type { MessageKey } from "@/i18n";
import type { ProjectTemplate } from "../vv/project-manifest";
import { loadTemplateOnce } from "./template-loader";

/** Every template kind the IDE knows about. */
export type TemplateKey = "todo" | "showcase" | "starter";

export interface TemplateDescriptor {
  key: TemplateKey;
  /** Manifest id, also what ProjectMeta stores; the todo id is historical (D-051). */
  id: string;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  /** Lazy module load, cached per process by template-loader.ts. */
  load: () => Promise<ProjectTemplate>;
}

/** The picker order: the default first. */
export const FACILIS_TEMPLATES: readonly TemplateDescriptor[] = [
  {
    key: "todo",
    id: "facilis",
    labelKey: "create.template.todo",
    descriptionKey: "create.template.todoDescription",
    load: () =>
      loadTemplateOnce("todo", () =>
        import("./facilis-template").then((module) => module.createFacilisTemplate()),
      ),
  },
  {
    key: "showcase",
    id: "facilis-showcase",
    labelKey: "create.template.showcase",
    descriptionKey: "create.template.showcaseDescription",
    load: () =>
      loadTemplateOnce("showcase", () =>
        import("./showcase-template").then((module) => module.createShowcaseTemplate()),
      ),
  },
  {
    key: "starter",
    id: "facilis-starter",
    labelKey: "create.template.starter",
    descriptionKey: "create.template.starterDescription",
    load: () =>
      loadTemplateOnce("starter", () =>
        import("./starter-template").then((module) => module.createStarterTemplate()),
      ),
  },
];

/** The template a new project gets when the caller does not choose one. */
export const DEFAULT_TEMPLATE_KEY: TemplateKey = "todo";

/** The descriptor for a key, or undefined when this build does not ship it. */
export function templateDescriptor(key: TemplateKey): TemplateDescriptor | undefined {
  return FACILIS_TEMPLATES.find((descriptor) => descriptor.key === key);
}

/** The default descriptor; the list always contains it. */
export function defaultTemplate(): TemplateDescriptor {
  const descriptor = templateDescriptor(DEFAULT_TEMPLATE_KEY);
  if (descriptor === undefined) throw new Error("template: default descriptor missing");
  return descriptor;
}

/** A create request from Home's dialog (and the smoke/profiler hooks). */
export interface CreateProjectOptions {
  dir: string;
  runInit: boolean;
  /** Descriptor key; omitted means the default template. */
  template?: TemplateKey;
}

/**
 * The descriptor a create request uses: the requested template when this build ships it,
 * else the default (a persisted choice from another build may name a template this one
 * does not have).
 */
export function templateForCreate(key: TemplateKey | undefined): TemplateDescriptor {
  return (key === undefined ? undefined : templateDescriptor(key)) ?? defaultTemplate();
}

/**
 * Resolve what a recent-project row stored. New rows store the manifest id; rows created
 * before the registry stored the only template's id, "facilis", which the todo descriptor
 * keeps, so the lookup is by id first and by key second. An unknown id (a row from the
 * removed 55-template catalog, D-051) resolves to nothing: the project still opens, but
 * Run drops into a shell instead of starting the wrong dev command.
 */
export function templateForStoredId(
  stored: string | null | undefined,
): TemplateDescriptor | undefined {
  if (stored === null || stored === undefined || stored === "") return undefined;
  return (
    FACILIS_TEMPLATES.find((descriptor) => descriptor.id === stored) ??
    FACILIS_TEMPLATES.find((descriptor) => descriptor.key === stored)
  );
}
