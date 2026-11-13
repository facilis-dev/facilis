// The framework reference data: one curated module per installed @facilis.dev package.
//
// Data lives in ide/src/ai/reference/ per package so each file stays well under the
// 300-line production limit; this module is the single aggregation point the lookup code
// imports, and the order matches the reading order of a generated project (core → data →
// auth → server runtime → tooling → date/time → storage → i18n).

import { AI_MODULE } from "./reference/ai";
import { ANALYZE_MODULE } from "./reference/analyze";
import { AUTH_MODULE } from "./reference/auth";
import { CORE_MODULE } from "./reference/core";
import { DB_MODULE } from "./reference/db";
import { I18N_DB_MODULE } from "./reference/i18n-db";
import { NITRO_MODULE } from "./reference/nitro";
import { STORAGE_MODULE } from "./reference/storage";
import { TIME_MODULE } from "./reference/time";
import type { FrameworkModule } from "./framework-reference";

export const FRAMEWORK_MODULES: readonly FrameworkModule[] = [
  CORE_MODULE,
  DB_MODULE,
  AUTH_MODULE,
  NITRO_MODULE,
  AI_MODULE,
  ANALYZE_MODULE,
  TIME_MODULE,
  STORAGE_MODULE,
  I18N_DB_MODULE,
];
