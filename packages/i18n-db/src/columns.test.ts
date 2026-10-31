import { getTableConfig, pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, expectTypeOf, it } from "vitest";

import { translatedText } from "./columns.ts";
import type { Translations } from "./translations.ts";

// A probe table shaped like a project schema: one translatable content field.
const posts = pgTable("translated_posts", {
  id: text("id").primaryKey(),
  title: translatedText("title"),
});

type PostRow = typeof posts.$inferSelect;

describe("translatedText", () => {
  it("creates a NOT NULL jsonb column typed as Translations", () => {
    const config = getTableConfig(posts);
    const title = config.columns.find((column) => column.name === "title");

    expect(title?.getSQLType()).toBe("jsonb");
    expect(title?.notNull).toBe(true);
    expectTypeOf<PostRow["title"]>().toEqualTypeOf<Translations>();
  });
});
