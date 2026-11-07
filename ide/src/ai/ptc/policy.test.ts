import { describe, expect, it } from "vitest";

import {
  assertReadablePath,
  assertSafeGlob,
  globMatcher,
  isExcludedPath,
  isReadablePath,
  isSafeProjectPath,
  redactSecrets,
} from "./policy";
import { isPtcToolError } from "./protocol";

describe("isSafeProjectPath", () => {
  it("accepts project-relative paths", () => {
    expect(isSafeProjectPath("src/App.tsx")).toBe(true);
    expect(isSafeProjectPath("db/schema.ts")).toBe(true);
    expect(isSafeProjectPath("package.json")).toBe(true);
    expect(isSafeProjectPath("src/my file.ts")).toBe(true);
  });

  it("refuses traversal, absolute and ambiguous paths", () => {
    expect(isSafeProjectPath("")).toBe(false);
    expect(isSafeProjectPath("  ")).toBe(false);
    expect(isSafeProjectPath(" /src/App.tsx")).toBe(false);
    expect(isSafeProjectPath("/src/App.tsx")).toBe(false);
    expect(isSafeProjectPath("../outside.ts")).toBe(false);
    expect(isSafeProjectPath("src/../outside.ts")).toBe(false);
    expect(isSafeProjectPath("src/./inside.ts")).toBe(false);
    expect(isSafeProjectPath("src//double.ts")).toBe(false);
    expect(isSafeProjectPath("C:\\windows\\x.ts")).toBe(false);
    expect(isSafeProjectPath("src\\windows-style.ts")).toBe(false);
  });
});

describe("isExcludedPath", () => {
  it("excludes secret, dependency, build, VCS and IDE-state paths", () => {
    for (const path of [
      ".env",
      ".env.local",
      ".env.production",
      "certs/server.pem",
      "certs/private.key",
      "id_rsa",
      "id_rsa.pub",
      ".git/config",
      "node_modules/react/index.js",
      "dist/assets/app.js",
      ".turbo/cache/x",
      ".facilis/graph.json",
      "coverage/lcov.info",
    ]) {
      expect(isExcludedPath(path), path).toBe(true);
    }
  });

  it("keeps ordinary project sources readable", () => {
    for (const path of [
      "src/App.tsx",
      "db/schema.ts",
      "server/routes/api/todos.get.ts",
      "package.json",
      "environment.ts",
      "src/keys.ts",
    ]) {
      expect(isExcludedPath(path), path).toBe(false);
      expect(isReadablePath(path), path).toBe(true);
    }
  });

  it("a safe path is not automatically readable", () => {
    expect(isSafeProjectPath("node_modules/react/index.js")).toBe(true);
    expect(isReadablePath("node_modules/react/index.js")).toBe(false);
  });
});

describe("assertReadablePath", () => {
  it("does not throw for readable paths", () => {
    expect(() => assertReadablePath("src/App.tsx")).not.toThrow();
  });

  it("throws a capability PtcToolError for traversal", () => {
    try {
      assertReadablePath("../../etc/passwd");
      throw new Error("expected a refusal");
    } catch (error) {
      expect(isPtcToolError(error)).toBe(true);
      if (isPtcToolError(error)) expect(error.kind).toBe("capability");
    }
  });

  it("throws a capability PtcToolError for excluded paths", () => {
    try {
      assertReadablePath(".env.local");
      throw new Error("expected a refusal");
    } catch (error) {
      expect(isPtcToolError(error)).toBe(true);
      if (isPtcToolError(error)) expect(error.message).toContain("excluded");
    }
  });
});

describe("assertSafeGlob", () => {
  it("accepts project-relative patterns", () => {
    expect(() => assertSafeGlob("**/*.ts")).not.toThrow();
    expect(() => assertSafeGlob("*.tsx")).not.toThrow();
    expect(() => assertSafeGlob("server/routes/*.ts")).not.toThrow();
  });

  it("refuses traversal and absolute patterns", () => {
    expect(() => assertSafeGlob("../**/*.ts")).toThrow();
    expect(() => assertSafeGlob("/etc/*.ts")).toThrow();
    expect(() => assertSafeGlob("src/../*.ts")).toThrow();
    expect(() => assertSafeGlob("")).toThrow();
  });
});

describe("globMatcher", () => {
  it("matches bare patterns against the file name", () => {
    const matcher = globMatcher("*.ts");
    expect(matcher("src/App.tsx")).toBe(false);
    expect(matcher("src/App.ts")).toBe(true);
    expect(matcher("db/schema.ts")).toBe(true);
  });

  it("anchors patterns with a slash at the project root", () => {
    const matcher = globMatcher("server/**/*.get.ts");
    expect(matcher("server/routes/api/todos.get.ts")).toBe(true);
    expect(matcher("server/index.get.ts")).toBe(true);
    expect(matcher("src/server/x.get.ts")).toBe(false);
    expect(matcher("server/routes/api/todos.post.ts")).toBe(false);
  });
});

describe("redactSecrets", () => {
  it("redacts quoted and bare secret assignments and keeps the key", () => {
    const source = [
      'const password = "hunter2";',
      '{"token": "abc123"}',
      "API_KEY=sk-live-123",
      "secret: hunter2",
    ].join("\n");
    const redacted = redactSecrets(source);
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("sk-live-123");
    expect(redacted).toContain("password = [redacted]");
    expect(redacted).toContain('"token": [redacted]');
    expect(redacted).toContain("API_KEY=[redacted]");
    expect(redacted).toContain("secret: [redacted]");
  });

  it("keeps environment references and unrelated code visible", () => {
    const source = [
      "password: process.env.DB_PASSWORD,",
      "token: null,",
      'const greeting = "hello";',
    ].join("\n");
    expect(redactSecrets(source)).toBe(source);
  });

  it("redacts complete and truncated PEM private key blocks", () => {
    const complete = [
      "const key = `",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA",
      "-----END RSA PRIVATE KEY-----",
      "`;",
    ].join("\n");
    const redacted = redactSecrets(complete);
    expect(redacted).not.toContain("MIIEowIBAAKCAQEA");
    expect(redacted).toContain("const key = `"); // code around the block is untouched

    // A capped read loses the END marker; the remaining body must still be redacted.
    const truncated = "let name;\n-----BEGIN PRIVATE KEY-----\nMIIEowIBAAKCAQEA";
    expect(redactSecrets(truncated)).toBe("let name;\n[redacted]");
  });
});
