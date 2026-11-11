import { defineHandler } from "nitro";
import { summarizeManifest, type ManifestSection } from "@facilis.dev/core";

import { guardDevRequest } from "../runtime/http-guard.ts";
import { jsonResult, parseRequestUrl, toResponse } from "../runtime/http.ts";
import {
  isNotModified,
  manifestResponse,
  notModifiedResult,
  summaryResponse,
} from "../runtime/manifest-response.ts";
import {
  ALL_MANIFEST_SECTIONS,
  parseSectionsParameter,
  selectManifestSections,
} from "../runtime/manifest-sections.ts";
import { getManifestSnapshot } from "../runtime/manifest-service.ts";

type ManifestFormat = "full" | "summary";

const NO_CACHE = { "cache-control": "no-cache" } as const;

function parseFormat(value: string | null): ManifestFormat | undefined {
  if (value === null || value === "" || value === "full") return "full";
  if (value === "summary") return "summary";
  return undefined;
}

/**
 * GET /__facilis/manifest — dev-only runtime projection of the project (SPEC §6).
 *
 * 200 full/partial, 304 on If-None-Match/since, 400 on invalid sections/format,
 * 403 origin mismatch, 404 in production, 503 when the project config is unusable.
 */
export default defineHandler(async (event) => {
  const guard = guardDevRequest(event.req.headers);
  if (guard) return toResponse(guard);

  const url = parseRequestUrl(event.req.url);
  const sections = parseSectionsParameter(url.searchParams.get("sections"));
  if (!sections.ok) {
    return toResponse(
      jsonResult(
        400,
        { code: "invalid_input", details: { parameter: "sections", invalid: sections.invalid } },
        { ...NO_CACHE },
      ),
    );
  }

  const format = parseFormat(url.searchParams.get("format"));
  if (format === undefined) {
    return toResponse(
      jsonResult(
        400,
        { code: "invalid_input", details: { parameter: "format", expected: ["full", "summary"] } },
        { ...NO_CACHE },
      ),
    );
  }

  const snapshot = await getManifestSnapshot();
  if (snapshot === null) {
    return toResponse(
      jsonResult(
        503,
        { code: "internal_error", details: { reason: "config_unavailable" } },
        { ...NO_CACHE },
      ),
    );
  }

  if (
    isNotModified({
      ifNoneMatch: event.req.headers.get("if-none-match"),
      since: url.searchParams.get("since"),
      revision: snapshot.revision,
    })
  ) {
    return toResponse(notModifiedResult(snapshot.revision));
  }

  const requestedSections: readonly ManifestSection[] = sections.sections ?? ALL_MANIFEST_SECTIONS;

  if (format === "summary") {
    return toResponse(
      summaryResponse({
        revision: snapshot.revision,
        generatedAt: snapshot.generatedAt,
        sections: requestedSections,
        summary: summarizeManifest(snapshot.data.manifest),
        warnings: snapshot.warnings,
      }),
    );
  }

  const selected = selectManifestSections(snapshot.data.manifest, sections.sections);
  // A failed section is omitted from the payload; the envelope warning explains why.
  if (snapshot.data.partial) delete selected.schema;

  return toResponse(
    manifestResponse({
      revision: snapshot.revision,
      generatedAt: snapshot.generatedAt,
      sections: requestedSections,
      manifest: selected,
      warnings: snapshot.warnings,
      partial: snapshot.data.partial,
    }),
  );
});
