import { describe, expect, it } from "vitest";

import { analyzeHostFiles } from "../analysis-fixtures";
import type { PatchValidationHost } from "../patch-validation";
import type { WebAccess } from "../web-access";
import { isPtcToolError, PtcToolError, type PtcToolExecutor } from "./protocol";
import { createToolRouter } from "./tools";
import { htmlToText } from "./web-text";

const ENCODER = new TextEncoder();
const HELLO = ENCODER.encode("hello");
/** sha256("hello"): a fixed expected hash proves the digest covers the downloaded bytes. */
const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

interface FetchResult {
  ok: boolean;
  url?: string;
  status?: number;
  contentType?: string;
  bytes?: number;
  text?: string;
  truncated?: boolean;
  reason?: string;
  detail?: string;
  path?: string;
  sha256?: string;
}

function access(overrides: Partial<WebAccess> = {}): WebAccess {
  return {
    policy: { kind: "open" },
    read: async (url) => ({
      ok: true,
      url,
      status: 200,
      contentType: "text/plain",
      bytes: HELLO,
    }),
    writeAsset: async () => undefined,
    addImage: () => true,
    takeImages: () => [],
    ...overrides,
  };
}

const FILES = () => ["facilis.config.ts", "src/App.tsx"];
const readPath = async (path: string) =>
  path === "src/App.tsx" ? "export const App = () => null;\n" : "";

function host(web: WebAccess | undefined): PatchValidationHost {
  return {
    files: FILES,
    read: readPath,
    manifestBase: () => null,
    syntaxChecker: () => ({ check: async () => [] }),
    analyze: (patches) => analyzeHostFiles(FILES(), readPath, patches),
    ...(web === undefined ? {} : { web }),
  };
}

async function call<T>(name: string, args: unknown, web: WebAccess | null = access()): Promise<T> {
  return (await createToolRouter(host(web ?? undefined)).execute({ name, args }, {})) as T;
}

async function run<T>(router: PtcToolExecutor, name: string, args: unknown): Promise<T> {
  return (await router.execute({ name, args }, {})) as T;
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (isPtcToolError(error)) return error;
    throw error;
  }
  throw new Error("expected the tool call to be refused");
}

describe("web tools", () => {
  it("advertises the web tools only when the host has WebAccess", () => {
    const withWeb = createToolRouter(host(access()))
      .specs()
      .map((entry) => entry.name);
    const without = createToolRouter(host(undefined))
      .specs()
      .map((entry) => entry.name);
    expect(withWeb).toEqual(expect.arrayContaining(["web_fetch", "web_image", "web_download"]));
    expect(without).not.toContain("web_fetch");
  });

  it("degrades to 'not implemented' when the host has no WebAccess", async () => {
    const error = await refusal(call("web_fetch", { url: "https://example.test/" }, null));
    expect(error.message).toContain("not implemented");
  });
});

describe("web_fetch", () => {
  it("reduces HTML to text and redacts secrets", async () => {
    const html = access({
      read: async () => ({
        ok: true,
        url: "https://example.test/page",
        status: 200,
        contentType: "text/html; charset=utf-8",
        bytes: ENCODER.encode(
          "<style>p{color:red}</style><script>steal()</script><h1>Title</h1><p>Hello&nbsp;world &amp; password = hunter2</p>",
        ),
      }),
    });
    const result = await call<FetchResult>("web_fetch", { url: "https://example.test/page" }, html);
    expect(result).toMatchObject({
      ok: true,
      url: "https://example.test/page",
      status: 200,
      contentType: "text/html; charset=utf-8",
      truncated: false,
    });
    expect(result.text).toContain("Title");
    expect(result.text).toContain("Hello world & password = [redacted]");
    expect(result.text).not.toContain("steal");
    expect(result.text).not.toContain("hunter2");
  });

  it("caps text at maxChars and refuses an out-of-range cap", async () => {
    const long = "x".repeat(5_000);
    const page = access({
      read: async (url) => ({
        ok: true,
        url,
        status: 200,
        contentType: "text/plain",
        bytes: ENCODER.encode(long),
      }),
    });
    const truncated = await call<FetchResult>(
      "web_fetch",
      { url: "https://example.test/big", maxChars: 500 },
      page,
    );
    expect(truncated.text).toHaveLength(500);
    expect(truncated.truncated).toBe(true);
    expect(
      (await refusal(call("web_fetch", { url: "https://example.test/", maxChars: 100 }))).message,
    ).toContain("500");
    expect((await refusal(call("web_fetch", {}))).message).toContain("url");
  });

  it("returns http, content-type and network failures as data", async () => {
    const notFound = await call<FetchResult>(
      "web_fetch",
      { url: "https://example.test/missing" },
      access({
        read: async (url) => ({
          ok: true,
          url,
          status: 404,
          contentType: "text/plain",
          bytes: HELLO,
        }),
      }),
    );
    expect(notFound).toEqual({ ok: false, reason: "http", status: 404 });
    const binary = await call<FetchResult>(
      "web_fetch",
      { url: "https://example.test/data.bin" },
      access({
        read: async (url) => ({
          ok: true,
          url,
          status: 200,
          contentType: "application/octet-stream",
          bytes: HELLO,
        }),
      }),
    );
    expect(binary.reason).toBe("content-type");
    expect(binary.detail).toContain("web_download");
    const offline = await call<FetchResult>(
      "web_fetch",
      { url: "https://example.test/" },
      access({
        read: async () => ({ ok: false, reason: "network", detail: "cors", bytesRead: 0 }),
      }),
    );
    expect(offline).toEqual({ ok: false, reason: "network", detail: "cors" });
  });

  it("turns a URL-policy refusal into the typed refusal", async () => {
    const thrown = await refusal(
      call(
        "web_fetch",
        { url: "http://plain.test/" },
        access({
          read: async () => {
            throw new PtcToolError("capability", "http is only allowed for the app origin");
          },
        }),
      ),
    );
    expect(thrown.message).toContain("web_fetch");
    expect(thrown.message).toContain("only allowed");
    const returned = await refusal(
      call(
        "web_fetch",
        { url: "https://other.test/" },
        access({
          read: async () => ({
            ok: false,
            reason: "capability",
            detail: "host is not in network.connect",
            bytesRead: 0,
          }),
        }),
      ),
    );
    expect(returned.message).toContain("network.connect");
  });
});

describe("web_image", () => {
  it("attaches an image as a data URL and enforces the two-image limit", async () => {
    const images: string[] = [];
    const web = access({
      read: async (url) => ({
        ok: true,
        url,
        status: 200,
        contentType: "image/png",
        bytes: Uint8Array.from([1, 2, 3]),
      }),
      addImage: (dataUrl) => {
        images.push(dataUrl);
        return true;
      },
    });
    const router = createToolRouter(host(web));
    await expect(run(router, "web_image", { url: "https://example.test/a.png" })).resolves.toEqual({
      ok: true,
      contentType: "image/png",
      bytes: 3,
    });
    expect(images).toEqual(["data:image/png;base64,AQID"]);
    await run(router, "web_image", { url: "https://example.test/b.png" });
    const third = await refusal(run(router, "web_image", { url: "https://example.test/c.png" }));
    expect(third.message).toContain("2 images");
  });

  it("refuses a non-image and reports a full image channel as data", async () => {
    const page = await call<FetchResult>(
      "web_image",
      { url: "https://example.test/page" },
      access({
        read: async (url) => ({
          ok: true,
          url,
          status: 200,
          contentType: "text/html",
          bytes: HELLO,
        }),
      }),
    );
    expect(page.reason).toBe("content-type");
    const full = await call<FetchResult>(
      "web_image",
      { url: "https://example.test/a.png" },
      access({
        read: async (url) => ({
          ok: true,
          url,
          status: 200,
          contentType: "image/png",
          bytes: HELLO,
        }),
        addImage: () => false,
      }),
    );
    expect(full).toMatchObject({ ok: false, reason: "image-limit" });
  });

  it("refuses a non-2xx image as data", async () => {
    const result = await call<FetchResult>(
      "web_image",
      { url: "https://example.test/missing.png" },
      access({
        read: async (url) => ({
          ok: true,
          url,
          status: 404,
          contentType: "image/png",
          bytes: HELLO,
        }),
      }),
    );
    expect(result).toEqual({ ok: false, reason: "http", status: 404 });
  });
});

describe("web_download", () => {
  it("writes under public/, normalizes the path and returns the hash", async () => {
    const writes: { path: string; bytes: Uint8Array }[] = [];
    const web = access({
      writeAsset: async (path, bytes) => {
        writes.push({ path, bytes });
      },
    });
    const result = await call<FetchResult>(
      "web_download",
      { url: "https://example.test/logo.png", path: "./public/logo.png" },
      web,
    );
    expect(result).toEqual({ ok: true, path: "public/logo.png", bytes: 5, sha256: HELLO_SHA256 });
    expect(writes[0]?.path).toBe("public/logo.png");
    const nested = await call<FetchResult>(
      "web_download",
      { url: "https://example.test/a.svg", path: "public/icons/a.svg" },
      web,
    );
    expect(nested.path).toBe("public/icons/a.svg");
  });

  it("refuses a destination outside public/ or excluded by the shared path policy", async () => {
    const router = createToolRouter(host(access()));
    for (const path of [
      "src/x.ts",
      "public/../src/x.ts",
      "public/.git/config",
      "public/.env",
      "public/node_modules/dep/index.js",
      "public/x\\y",
      "/",
      "/public/icons/a.svg",
      "public/",
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- one router, so the refusals are asserted in order.
      const error = await refusal(
        run(router, "web_download", { url: "https://example.test/a", path }),
      );
      expect(error.message).toContain("path");
    }
    const absolute = await refusal(
      run(router, "web_download", { url: "https://example.test/a", path: "/public/logo.png" }),
    );
    expect(absolute.message).toContain("project-relative");
  });

  it("overwrites an existing asset and caps downloads at five", async () => {
    const router = createToolRouter(host(access()));
    for (let index = 0; index < 5; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- the five downloads fill one shared program budget.
      await run(router, "web_download", {
        url: "https://example.test/" + index,
        path: "public/asset.bin",
      });
    }
    const sixth = await refusal(
      run(router, "web_download", { url: "https://example.test/5", path: "public/asset.bin" }),
    );
    expect(sixth.message).toContain("5 downloads");
  });

  it("refuses a non-2xx download without writing an asset", async () => {
    const writes: string[] = [];
    const result = await call<FetchResult>(
      "web_download",
      { url: "https://example.test/missing.png", path: "public/missing.png" },
      access({
        read: async (url) => ({
          ok: true,
          url,
          status: 500,
          contentType: "text/html",
          bytes: HELLO,
        }),
        writeAsset: async (path) => {
          writes.push(path);
        },
      }),
    );
    expect(result).toEqual({ ok: false, reason: "http", status: 500 });
    expect(writes).toEqual([]);
  });
});

describe("web budget", () => {
  it("charges a failing read as a call and stops after ten", async () => {
    const web = access({
      read: async () => ({ ok: false, reason: "network", detail: "cors", bytesRead: 0 }),
    });
    const router = createToolRouter(host(web));
    for (let index = 0; index < 9; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- ten calls exhaust one shared per-program budget.
      await expect(
        run(router, "web_fetch", { url: "https://example.test/" + index }),
      ).resolves.toEqual({ ok: false, reason: "network", detail: "cors" });
    }
    await expect(run(router, "web_fetch", { url: "https://example.test/9" })).resolves.toEqual({
      ok: false,
      reason: "network",
      detail: "cors",
    });
    const exhausted = await refusal(run(router, "web_fetch", { url: "https://example.test/10" }));
    expect(exhausted.message).toContain("10 web calls");
  });

  it("charges the bytes an over-cap refusal streamed", async () => {
    const caps: number[] = [];
    const web = access({
      read: async (url, maxBytes) => {
        caps.push(maxBytes);
        if (caps.length === 1) {
          return {
            ok: false,
            reason: "capability",
            detail: "the response body exceeds the 1048576-byte read cap",
            bytesRead: 6_000_000,
          };
        }
        return {
          ok: true,
          url,
          status: 200,
          contentType: "application/octet-stream",
          bytes: new Uint8Array(maxBytes),
        };
      },
    });
    const router = createToolRouter(host(web));
    const refused = await refusal(run(router, "web_fetch", { url: "https://example.test/huge" }));
    expect(refused.message).toContain("exceeds");
    await run(router, "web_download", { url: "https://example.test/a.bin", path: "public/a.bin" });
    expect(caps[1]).toBe(2_388_608);
  });

  it("caps a read at what is left of the 8 MB program budget", async () => {
    const caps: number[] = [];
    const web = access({
      read: async (url, maxBytes) => {
        caps.push(maxBytes);
        return {
          ok: true,
          url,
          status: 200,
          contentType: "application/octet-stream",
          bytes: new Uint8Array(maxBytes),
        };
      },
    });
    const router = createToolRouter(host(web));
    const first = await run<FetchResult>(router, "web_download", {
      url: "https://example.test/a.bin",
      path: "public/a.bin",
    });
    expect(first.bytes).toBe(5_242_880);
    const second = await run<FetchResult>(router, "web_download", {
      url: "https://example.test/b.bin",
      path: "public/b.bin",
    });
    expect(second.bytes).toBe(3_145_728);
    expect(caps).toEqual([5_242_880, 3_145_728]);
    const third = await refusal(
      run(router, "web_download", { url: "https://example.test/c.bin", path: "public/c.bin" }),
    );
    expect(third.message).toContain("budget");
  });

  it("shares the call cap across the three tools", async () => {
    const router = createToolRouter(host(access()));
    for (let index = 0; index < 10; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- the ten calls are the shared budget under test.
      await run(router, "web_fetch", { url: "https://example.test/" + index });
    }
    const refused = await refusal(
      run(router, "web_download", { url: "https://example.test/a", path: "public/a.bin" }),
    );
    expect(refused.message).toContain("10 web calls");
  });

  it("shares the byte budget across the three tools", async () => {
    const caps: number[] = [];
    const web = access({
      read: async (url, maxBytes) => {
        caps.push(maxBytes);
        return {
          ok: true,
          url,
          status: 200,
          contentType: "text/plain",
          bytes: new Uint8Array(maxBytes),
        };
      },
    });
    const router = createToolRouter(host(web));
    await run(router, "web_download", { url: "https://example.test/a.bin", path: "public/a.bin" });
    await run(router, "web_fetch", { url: "https://example.test/page" });
    await run(router, "web_download", { url: "https://example.test/b.bin", path: "public/b.bin" });
    expect(caps).toEqual([5_242_880, 1_048_576, 2_097_152]);
    const exhausted = await refusal(run(router, "web_fetch", { url: "https://example.test/more" }));
    expect(exhausted.message).toContain("budget");
  });
});

describe("htmlToText", () => {
  it("keeps prose, separates blocks and decodes entities once", () => {
    const text = htmlToText(
      "<div><h1>Title</h1><p>one<br>two</p><table><tr><td>a</td><td>b</td></tr></table><p>&#39;quoted&#39; &amp;lt; &hellip;</p><p></p><p></p></div>",
    );
    expect(text).toContain("Title\none\ntwo");
    expect(text).toContain("a b");
    expect(text).toContain("'quoted' &lt; …");
    expect(text).not.toContain("\n\n\n");
  });
});
