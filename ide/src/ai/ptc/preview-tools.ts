// The preview tool handlers (D-111): what the model may do to the running app.
//
// Arguments come from an untrusted sandboxed program, so they are validated here. "The project
// is not running" is returned as data (available: false) instead of an exception: the model can
// ask the user to Run the app and retry. The project itself is never written.

import type { PreviewAccess } from "../preview-access";
import { PtcToolError, type PtcJson } from "./protocol";

type Args = Record<string, unknown>;
export type PreviewHandler = (args: Args) => Promise<PtcJson>;

const MAX_SELECTOR = 300;
const MAX_TEXT = 2_000;
const MAX_PATH = 300;
const MAX_DOM_CHARS = 8_000;
const WAIT_MAX_MS = 4_000;

function requiredString(args: Args, key: string, max: number): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new PtcToolError(
      "capability",
      key + " must be a non-empty string of at most " + max + " characters",
    );
  }
  return value;
}

function optionalString(args: Args, key: string, max: number): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new PtcToolError(
      "capability",
      key + " must be a non-empty string of at most " + max + " characters",
    );
  }
  return value;
}

function optionalInteger(args: Args, key: string, min: number, max: number): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new PtcToolError(
      "capability",
      key + " must be an integer between " + min + " and " + max,
    );
  }
  return value;
}

function unavailable(): PtcJson {
  return {
    available: false,
    reason: "the project is not running: ask the user to Run it, then retry",
  };
}

function onRoute(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("..")) {
    throw new PtcToolError("capability", "path must be a project route starting with /");
  }
  return path;
}

export function createPreviewHandlers(access: PreviewAccess): Record<string, PreviewHandler> {
  return {
    async preview_state() {
      return access.available() ? access.state() : unavailable();
    },
    async preview_console() {
      return access.available() ? access.console() : unavailable();
    },
    async preview_network() {
      return access.available() ? access.network() : unavailable();
    },
    async preview_dom(args) {
      if (!access.available()) return unavailable();
      const selector = optionalString(args, "selector", MAX_SELECTOR) ?? null;
      const maxChars = optionalInteger(args, "maxChars", 200, MAX_DOM_CHARS) ?? 2_000;
      return access.dom(selector, maxChars);
    },
    async preview_click(args) {
      if (!access.available()) return unavailable();
      return access.click(requiredString(args, "selector", MAX_SELECTOR));
    },
    async preview_fill(args) {
      if (!access.available()) return unavailable();
      const selector = requiredString(args, "selector", MAX_SELECTOR);
      const text = requiredString(args, "text", MAX_TEXT);
      return access.fill(selector, text);
    },
    async preview_open(args) {
      if (!access.available()) return unavailable();
      const path = onRoute(requiredString(args, "path", MAX_PATH));
      return access.open(path);
    },
    async preview_wait(args) {
      if (!access.available()) return unavailable();
      const selector = optionalString(args, "selector", MAX_SELECTOR) ?? null;
      const ms = optionalInteger(args, "ms", 100, WAIT_MAX_MS) ?? 1_000;
      if (selector === null && args["ms"] === undefined) {
        throw new PtcToolError("capability", "pass a selector or ms");
      }
      return access.wait(selector, ms);
    },
  };
}
