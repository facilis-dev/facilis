import { describe, expect, it } from "vitest";

import { computeRevision, type RevisionInput } from "./revision.ts";

const SHA1_HEX = /^[0-9a-f]{40}$/;

function baseInput(): RevisionInput {
  return {
    configContent: "export default defineConfig({ auth: { defaultRole: 'user' } })",
    schemaFiles: [
      { path: "db/schema.ts", content: "export const todos = pgTable('todos', {})" },
      { path: "db/users.ts", content: "export const users = pgTable('users', {})" },
    ],
    openApiSpec: {
      openapi: "3.1.0",
      paths: { "/api/todos": { get: { summary: "List todos" } } },
    },
    blockManifests: [
      {
        path: "node_modules/@facilis.dev/blocks/DataTable/manifest.ts",
        manifest: {
          name: "DataTable",
          version: "0.0.0",
          category: "data",
          description: "table",
          propsSchema: {},
        },
      },
    ],
    localeCatalogs: { en: { "todos.title": "Todos" }, fr: { "todos.title": "Tâches" } },
  };
}

describe("computeRevision", () => {
  it("returns a 40-char lowercase SHA-1 hex string", async () => {
    const revision = await computeRevision(baseInput());

    expect(revision).toMatch(SHA1_HEX);
  });

  it("is deterministic for the same input", async () => {
    const first = await computeRevision(baseInput());
    const second = await computeRevision(baseInput());

    expect(second).toBe(first);
  });

  it("changes when a schema file changes", async () => {
    const changed = baseInput();
    const revision = await computeRevision(changed);
    const next = await computeRevision({
      ...changed,
      schemaFiles: [
        {
          path: "db/schema.ts",
          content: "export const todos = pgTable('todos', { title: text() })",
        },
        { path: "db/users.ts", content: "export const users = pgTable('users', {})" },
      ],
    });

    expect(next).not.toBe(revision);
  });

  it("changes when the config, OpenAPI spec, block manifest or locales change", async () => {
    const revision = await computeRevision(baseInput());

    await expect(
      computeRevision({ ...baseInput(), configContent: "export default defineConfig({})" }),
    ).resolves.not.toBe(revision);
    await expect(
      computeRevision({ ...baseInput(), openApiSpec: { openapi: "3.1.0", paths: {} } }),
    ).resolves.not.toBe(revision);
    await expect(
      computeRevision({
        ...baseInput(),
        blockManifests: [{ path: "node_modules/x/manifest.ts", manifest: { name: "X" } as never }],
      }),
    ).resolves.not.toBe(revision);
    await expect(
      computeRevision({ ...baseInput(), localeCatalogs: { en: { "todos.title": "Tasks" } } }),
    ).resolves.not.toBe(revision);
  });

  it("ignores file order and JSON key order", async () => {
    const input = baseInput();
    const reordered: RevisionInput = {
      ...input,
      schemaFiles: (input.schemaFiles ?? []).toReversed(),
      openApiSpec: {
        paths: { "/api/todos": { get: { summary: "List todos" } } },
        openapi: "3.1.0",
      },
      localeCatalogs: { fr: { "todos.title": "Tâches" }, en: { "todos.title": "Todos" } },
    };

    expect(await computeRevision(reordered)).toBe(await computeRevision(input));
  });

  it("hashes absent optional sections like empty ones", async () => {
    const minimal = await computeRevision({ configContent: "x" });
    const empty = await computeRevision({
      configContent: "x",
      schemaFiles: [],
      openApiSpec: {},
      blockManifests: [],
      localeCatalogs: {},
    });

    expect(empty).toBe(minimal);
  });
});
