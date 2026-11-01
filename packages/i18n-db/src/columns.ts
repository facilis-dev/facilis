import { jsonb } from "drizzle-orm/pg-core";

import type { Translations } from "./translations.ts";

/**
 * A translatable content field: one NOT NULL `jsonb` column holding `{ locale: text }`.
 * A project schema re-exports this helper (`title: translatedText("title")`) and lets
 * drizzle-kit generate the migration; the package ships none.
 */
export function translatedText(name: string) {
  return jsonb(name).$type<Translations>().notNull();
}
