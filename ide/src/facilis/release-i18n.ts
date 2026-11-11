// The Release Preview's typed view of the IDE catalogue.
//
// The strings live in en-release-preview.ts / it-release-preview.ts and join the IDE
// catalogue through en.ts / it.ts. This module only narrows the key type to the block, so a
// call site cannot drift onto another feature's key while still going through the IDE's t().
import type { I18nParams } from "@facilis.dev/core/i18n";
import { t } from "@/i18n";
import { releasePreviewEn } from "@/i18n/en-release-preview";

export type ReleaseMessageKey = keyof typeof releasePreviewEn;

/** Translate one Release Preview key; unknown keys return themselves (never throws). */
export function rt(key: ReleaseMessageKey, params?: I18nParams): string {
  return t(key, params);
}
