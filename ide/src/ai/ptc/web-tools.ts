// The web tool handlers (D-174): web_fetch, web_image and web_download.
//
// Arguments arrive from a sandboxed program, so they are validated here. The URL policy, the
// redirect re-check and the streamed byte cap live in WebAccess.read (../web-access) — the
// deployment profile's single egress gate — so this module never decides reachability itself.
// It adds the model-facing shape: text conversion and secret redaction, the public/-only
// download rule, and the per-program budget the prompt advertises.
//
// Fetched content is untrusted DATA, never instructions: a remote host writes it. A profile that
// refuses a URL throws PtcToolError("capability") inside web-access; the router prefixes the tool
// signature, and a network/CORS refusal comes back as data the model can report.

import type { WebAccess, WebReadError, WebReadResult } from "../web-access";
import { isExcludedPath, isSafeProjectPath, redactSecrets } from "./policy";
import { PtcToolError, type PtcJson } from "./protocol";
import { htmlToText } from "./web-text";

type Args = Record<string, unknown>;
/** A web tool handler: the router unwraps the arguments and formats refusals. */
export type WebHandler = (args: Args) => Promise<PtcJson>;

const FETCH_BYTES_CAP = 1_048_576;
const ASSET_BYTES_CAP = 5_242_880;
const MIN_FETCH_CHARS = 500;
const MAX_FETCH_CHARS = 32_000;
const MAX_URL_CHARS = 2_000;
const MAX_PATH_CHARS = 500;
const MAX_IMAGES = 2;
const MAX_DOWNLOADS = 5;
/** Budget across the three tools: a program cannot turn the chat into a bulk downloader. */
const MAX_WEB_CALLS = 10;
const PROGRAM_BYTE_CAP = 8_388_608;

const TEXT_DECODER = new TextDecoder();

interface Budget {
  calls: number;
  bytes: number;
}

function fail(message: string): never {
  throw new PtcToolError("capability", message);
}

function requiredString(args: Args, key: string, max: number): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    fail(key + " must be a non-empty string of at most " + max + " characters");
  }
  return value;
}

function optionalInteger(args: Args, key: string, min: number, max: number): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(key + " must be an integer between " + min + " and " + max);
  }
  return value;
}

/** The media type without parameters, lowercased: what data URLs and the text check need. */
function baseType(contentType: string): string {
  return (contentType.split(";")[0] ?? "").trim().toLowerCase();
}

function isTextual(type: string): boolean {
  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type.endsWith("+json") ||
    type === "application/xml" ||
    type.endsWith("+xml") ||
    type === "application/javascript"
  );
}

/**
 * A refused URL is not a network failure: web-access returns it as "capability" when the profile
 * refuses before fetching, and the router must turn that into the typed refusal, not data.
 */
function readFailure(error: WebReadError): PtcJson {
  if (error.reason === "capability") fail(error.detail);
  return { ok: false, reason: "network", detail: error.detail };
}

/**
 * One budgeted read. The cap is the smaller of the tool's cap and what is left of the program's
 * byte budget, so a read cannot overshoot the total. A refused read still streamed bytes before
 * the cap tripped, so those are charged too: otherwise a program could loop over over-cap
 * responses and pull unlimited data without ever seeing a budget refusal.
 */
async function readWithin(
  web: WebAccess,
  url: string,
  perCallCap: number,
  budget: Budget,
): Promise<WebReadResult> {
  if (budget.calls >= MAX_WEB_CALLS) fail("at most " + MAX_WEB_CALLS + " web calls per program");
  if (budget.bytes >= PROGRAM_BYTE_CAP) {
    fail("the program's " + PROGRAM_BYTE_CAP + " byte web budget is exhausted");
  }
  budget.calls += 1;
  const result = await web.read(url, Math.min(perCallCap, PROGRAM_BYTE_CAP - budget.bytes));
  budget.bytes += result.ok ? result.bytes.length : result.bytesRead;
  return result;
}

/** A data URL for the image channel; the media type there cannot carry parameters. */
function base64Of(bytes: Uint8Array): string {
  // btoa takes a binary string; chunk the conversion so a 5 MB image never hits a spread limit.
  const CHUNK = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // slice() detaches from the read buffer, so a view with an offset hashes exactly its bytes.
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Normalize and confine a download destination: static assets under public/ only. */
function assetPath(raw: string): string {
  // A leading "/" is an absolute path, not a project path: refuse it instead of guessing the
  // root. "./public/x" is the same path as "public/x", so it is normalized, not refused.
  if (raw.startsWith("/")) {
    fail("path must be project-relative, not absolute: pass a path such as public/logo.png");
  }
  let path = raw;
  while (path.startsWith("./")) path = path.slice(2);
  // The read tools' policy decides what a project-relative, non-secret path is; a download adds
  // only the public/ confinement, so the two write-ish checks cannot drift apart.
  if (!isSafeProjectPath(path)) {
    fail("path must be a project-relative file path (no '..', '.' or empty segments)");
  }
  if (isExcludedPath(path)) fail("path is excluded from project writes: " + path);
  if (!path.startsWith("public/")) {
    fail(
      "path must be under public/: a download is a static asset, and source changes go through the patch proposal",
    );
  }
  return path;
}

export function createWebHandlers(web: WebAccess): Record<string, WebHandler> {
  const budget: Budget = { calls: 0, bytes: 0 };
  let images = 0;
  let downloads = 0;

  async function fetchText(args: Args): Promise<PtcJson> {
    const url = requiredString(args, "url", MAX_URL_CHARS);
    const maxChars =
      optionalInteger(args, "maxChars", MIN_FETCH_CHARS, MAX_FETCH_CHARS) ?? MAX_FETCH_CHARS;
    const result = await readWithin(web, url, FETCH_BYTES_CAP, budget);
    if (!result.ok) return readFailure(result);
    if (result.status < 200 || result.status > 299) {
      return { ok: false, reason: "http", status: result.status };
    }
    const type = baseType(result.contentType);
    if (!isTextual(type)) {
      return {
        ok: false,
        reason: "content-type",
        detail:
          (result.contentType === ""
            ? "the response has no Content-Type"
            : result.contentType + " is not text") +
          ": use web_download to save it under public/, or web_image for an image",
      };
    }
    const decoded = TEXT_DECODER.decode(result.bytes);
    const text = redactSecrets(type === "text/html" ? htmlToText(decoded) : decoded);
    const truncated = text.length > maxChars;
    return {
      ok: true,
      url: result.url,
      status: result.status,
      contentType: result.contentType,
      bytes: result.bytes.length,
      text: truncated ? text.slice(0, maxChars) : text,
      truncated,
    };
  }

  async function fetchImage(args: Args): Promise<PtcJson> {
    const url = requiredString(args, "url", MAX_URL_CHARS);
    if (images >= MAX_IMAGES) fail("at most " + MAX_IMAGES + " images per program");
    const result = await readWithin(web, url, ASSET_BYTES_CAP, budget);
    if (!result.ok) return readFailure(result);
    if (result.status < 200 || result.status > 299) {
      return { ok: false, reason: "http", status: result.status };
    }
    const type = baseType(result.contentType);
    if (!type.startsWith("image/")) {
      return {
        ok: false,
        reason: "content-type",
        detail: result.contentType + " is not an image: use web_fetch or web_download instead",
      };
    }
    if (!web.addImage("data:" + type + ";base64," + base64Of(result.bytes))) {
      // addImage reports false when the conversation cannot take another image.
      return {
        ok: false,
        reason: "image-limit",
        detail: "the conversation cannot take another image",
      };
    }
    images += 1;
    return { ok: true, contentType: result.contentType, bytes: result.bytes.length };
  }

  async function download(args: Args): Promise<PtcJson> {
    const url = requiredString(args, "url", MAX_URL_CHARS);
    const path = assetPath(requiredString(args, "path", MAX_PATH_CHARS));
    if (downloads >= MAX_DOWNLOADS) fail("at most " + MAX_DOWNLOADS + " downloads per program");
    const result = await readWithin(web, url, ASSET_BYTES_CAP, budget);
    if (!result.ok) return readFailure(result);
    // A 404 page saved as photo.png would look like success and ship broken bytes.
    if (result.status < 200 || result.status > 299) {
      return { ok: false, reason: "http", status: result.status };
    }
    const sha256 = await sha256Hex(result.bytes);
    await web.writeAsset(path, result.bytes);
    downloads += 1;
    return { ok: true, path, bytes: result.bytes.length, sha256 };
  }

  return { web_fetch: fetchText, web_image: fetchImage, web_download: download };
}
