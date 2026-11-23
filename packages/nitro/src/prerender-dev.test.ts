import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  isPrerenderFresh,
  prerenderDevMiddleware,
  prerenderPreviewMiddleware,
  readPrerenderStamp,
  writePrerenderStamp,
} from "./prerender-dev.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "facilis-prerender-dev-"));
  roots.push(root);
  return root;
}

interface FakeRes {
  headers: Record<string, string>;
  body: string | null;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

function fakeRes(): FakeRes {
  const res: FakeRes = {
    headers: {},
    body: null,
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
    },
    end(body) {
      res.body = body ?? null;
    },
  };
  return res;
}

const HTML =
  '<html><head><script type="module" src="/assets/index-abc.js"></script></head>' +
  '<body><div id="root"><h1>Stored</h1></div><a href="/about">About</a></body></html>';

function storedProject(routes: string[] = ["/", "/about"]): { root: string; outDir: string } {
  const root = project();
  const outDir = resolve(root, "dist");
  mkdirSync(resolve(outDir, "about"), { recursive: true });
  writeFileSync(resolve(outDir, "index.html"), HTML);
  writeFileSync(resolve(outDir, "about/index.html"), HTML);
  writeFileSync(resolve(outDir, "shell.html"), '<div id="root"></div>');
  mkdirSync(resolve(root, "src"), { recursive: true });
  writeFileSync(resolve(root, "src/app.tsx"), "export {};");
  writePrerenderStamp(root, { outDir, routes, origin: null, builtAt: Date.now() + 5000 });
  return { root, outDir };
}

describe("stamp", () => {
  it("round-trips and rejects corrupt files", () => {
    const root = project();
    writePrerenderStamp(root, { outDir: "/x", routes: ["/"], origin: "https://x.dev", builtAt: 1 });
    expect(readPrerenderStamp(root)).toEqual({ outDir: "/x", routes: ["/"], origin: "https://x.dev", builtAt: 1 });
    writeFileSync(resolve(root, ".facilis/prerender.json"), "{corrupt");
    expect(readPrerenderStamp(root)).toBeNull();
    expect(readPrerenderStamp(project())).toBeNull();
  });
});

describe("isPrerenderFresh", () => {
  it("is false when a source file is newer than the build", () => {
    const { root } = storedProject();
    const stamp = readPrerenderStamp(root);
    expect(stamp).not.toBeNull();
    const future = new Date(Date.now() + 60_000);
    utimesSync(resolve(root, "src/app.tsx"), future, future);
    expect(isPrerenderFresh(root, stamp?.builtAt ?? 0)).toBe(false);
  });
});

describe("prerenderDevMiddleware", () => {
  const get = (url: string, accept = "text/html", extra: Record<string, string> = {}) => ({
    method: "GET",
    url,
    headers: { accept, ...extra },
  });

  it("serves stored HTML with dev assets for a declared route", () => {
    const { root } = storedProject();
    const res = fakeRes();
    let nexted = false;
    prerenderDevMiddleware(root)(get("/about") as never, res as never, () => {
      nexted = true;
    });
    expect(nexted).toBe(false);
    expect(res.body).toContain("<h1>Stored</h1>");
    expect(res.body).toContain('src="/src/main.tsx"');
    expect(res.body).not.toContain("/assets/");
    expect(res.headers["content-type"]).toContain("text/html");
    // The IDE preview badge distinguishes prerendered from shell by this marker (#85).
    expect(res.headers["x-facilis-render"]).toBe("prerender");
  });

  it("rewrites anchor hrefs to the forwarded preview base", () => {
    const { root } = storedProject();
    const res = fakeRes();
    prerenderDevMiddleware(root)(
      get("/about", "text/html", { "x-forwarded-prefix": "/preview/5173" }) as never,
      res as never,
      () => {},
    );
    expect(res.body).toContain('href="/preview/5173/about"');
  });

  it.each([
    ["unknown route", get("/nope"), false],
    ["non-GET", { method: "POST", url: "/about", headers: { accept: "text/html" } }, false],
    ["non-html accept", get("/about", "application/json"), false],
  ])("falls through for %s", (_label, req, _served) => {
    const { root } = storedProject();
    const res = fakeRes();
    let nexted = false;
    prerenderDevMiddleware(root)(req as never, res as never, () => {
      nexted = true;
    });
    expect(nexted).toBe(true);
    expect(res.body).toBeNull();
    expect(res.headers["x-facilis-render"]).toBeUndefined();
  });

  it("falls through when the build is stale", () => {
    const { root } = storedProject();
    const future = new Date(Date.now() + 60_000);
    utimesSync(resolve(root, "src/app.tsx"), future, future);
    let nexted = false;
    prerenderDevMiddleware(root)(get("/about") as never, fakeRes() as never, () => {
      nexted = true;
    });
    expect(nexted).toBe(true);
  });
});

describe("prerenderPreviewMiddleware", () => {
  it("rewrites unknown HTML routes to shell.html", () => {
    const { root } = storedProject();
    const req = { method: "GET", url: "/nope", headers: { accept: "text/html" } };
    prerenderPreviewMiddleware(root)(req as never, fakeRes() as never, () => {});
    expect(req.url).toBe("/shell.html");
  });

  it("leaves declared routes and the root alone", () => {
    const { root } = storedProject();
    for (const url of ["/about", "/"]) {
      const req = { method: "GET", url, headers: { accept: "text/html" } };
      prerenderPreviewMiddleware(root)(req as never, fakeRes() as never, () => {});
      expect(req.url).toBe(url);
    }
  });
});
