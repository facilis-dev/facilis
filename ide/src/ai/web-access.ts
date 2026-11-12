// The chat's bridge to the public web (D-175).
//
// The tool layer (ptc/web-tools.ts) never calls fetch or touches the VFS itself: it asks this
// seam, which applies the deployment's web policy before any request, strips credentials,
// re-checks the URL a redirect landed on, and caps the body while streaming. A browser page
// cannot bypass CORS, so a host that does not allow the IDE origin is reported as a network
// failure — a real limitation of a browser-only client, not a bug in this module.
//
// Node-testable: fetch and the project writer are injected ports. The one host fact is
// `pageOrigin`; the IDE passes location.origin.

import { webUrlAllowed, type WebPolicy } from "@/deploy/web-policy";
import { PtcToolError } from "./ptc/protocol";

export interface WebRead {
  ok: true;
  url: string;
  status: number;
  contentType: string;
  bytes: Uint8Array;
}

export interface WebReadError {
  ok: false;
  reason: "network" | "capability";
  detail: string;
  /**
   * The bytes actually streamed before the refusal (0 when nothing was read). The tool layer
   * charges them to the program's byte budget, so an over-cap read cannot move traffic for
   * free; a network failure reports 0 because the bytes delivered before it threw are not
   * attributable to a response.
   */
  bytesRead: number;
}

export type WebReadResult = WebRead | WebReadError;

export interface WebPorts {
  /** The compiled deployment policy (current.webAccess); the seam exists only when non-null. */
  policy: WebPolicy;
  /** location.origin: the one plain-http origin a read may target (local development). */
  pageOrigin: string;
  /** Injected by the tests; the page's fetch otherwise. */
  fetchApi?: (url: string, init: RequestInit) => Promise<Response>;
  /** Write one project-relative path into the VFS (the chat host converts it to absolute). */
  writeAsset: (path: string, bytes: Uint8Array) => Promise<void>;
}

export interface WebAccess {
  readonly policy: WebPolicy;
  read(url: string, maxBytes: number): Promise<WebReadResult>;
  writeAsset(path: string, bytes: Uint8Array): Promise<void>;
  /** Keep one image for the turn loop's image channel (D-112); false when the cap is hit. */
  addImage(dataUrl: string): boolean;
  /** Drain the images taken since the last call; the turn loop attaches them. */
  takeImages(): string[];
}

/** At most this many images travel with one program's result, like the preview (D-112). */
const MAX_IMAGES = 2;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What the streaming cap produced: the bytes, or how many were read before the refusal. */
type BodyRead = { ok: true; bytes: Uint8Array } | { ok: false; bytesRead: number };

/**
 * Read the whole body unless it passes `maxBytes`; the over-cap branch reports the bytes it
 * streamed so the caller can charge them. The cap is enforced on the stream, not on
 * content-length, because a server can lie about the length.
 */
async function readBody(response: Response, maxBytes: number): Promise<BodyRead> {
  if (response.body === null) return { ok: true, bytes: new Uint8Array(0) };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- a body stream is read one chunk at a time.
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // oxlint-disable-next-line no-await-in-loop -- release the connection before returning.
      await reader.cancel();
      return { ok: false, bytesRead: total };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export function createWebAccess(ports: WebPorts): WebAccess {
  const fetchApi =
    ports.fetchApi ??
    ((url: string, init: RequestInit): Promise<Response> => globalThis.fetch(url, init));
  const images: string[] = [];
  return {
    policy: ports.policy,
    async read(rawUrl, maxBytes) {
      // The policy runs first: a refused URL must never leave the browser.
      const allowed = webUrlAllowed(ports.policy, rawUrl, ports.pageOrigin);
      if (!allowed.ok) throw new PtcToolError("capability", allowed.reason);
      let response: Response;
      try {
        response = await fetchApi(allowed.url.href, { credentials: "omit", redirect: "follow" });
      } catch (error) {
        // CORS, DNS, TLS, a refused connection: all indistinguishable from a page and all
        // reported as data so the model can tell the user instead of retrying blindly.
        return { ok: false, reason: "network", detail: messageOf(error), bytesRead: 0 };
      }
      // "follow" hides every intermediate and final hop from the policy: a public URL may
      // redirect at a host the deployment never allowed, so the landed URL is checked again.
      const landed = webUrlAllowed(
        ports.policy,
        response.url === "" ? allowed.url.href : response.url,
        ports.pageOrigin,
      );
      if (!landed.ok) {
        await response.body?.cancel().catch(() => {});
        throw new PtcToolError("capability", "redirect refused: " + landed.reason);
      }
      let body: BodyRead;
      try {
        body = await readBody(response, maxBytes);
      } catch (error) {
        // A stream that fails mid-way reports no byte count: the seam cannot attribute the
        // traffic a failed transport delivered, so the budget is never charged speculatively.
        return { ok: false, reason: "network", detail: messageOf(error), bytesRead: 0 };
      }
      if (!body.ok) {
        return {
          ok: false,
          reason: "capability",
          detail: "the response body exceeds the " + maxBytes + "-byte read cap",
          bytesRead: body.bytesRead,
        };
      }
      return {
        ok: true,
        url: landed.url.href,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        bytes: body.bytes,
      };
    },
    writeAsset(path, bytes) {
      return ports.writeAsset(path, bytes);
    },
    addImage(dataUrl) {
      if (images.length >= MAX_IMAGES) return false;
      images.push(dataUrl);
      return true;
    },
    takeImages() {
      return images.splice(0, images.length);
    },
  };
}
