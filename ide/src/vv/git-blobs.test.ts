import { describe, expect, it } from "vitest";
import { diffTrees, gitBlobSha, isClean, sha1Hex } from "./git-blobs";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("sha1Hex", () => {
  it("matches the published vectors", () => {
    expect(sha1Hex(bytes(""))).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(sha1Hex(bytes("abc"))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha1Hex(bytes("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe(
      "84983e441c3bd26ebaae4aa1f95129e5e54670f1",
    );
  });

  it("hashes bytes, not text (invalid UTF-8 is fine)", () => {
    expect(sha1Hex(new Uint8Array([0xff, 0xfe, 0x00]))).toBe(
      sha1Hex(new Uint8Array([0xff, 0xfe, 0x00])),
    );
  });
});

describe("gitBlobSha", () => {
  it("is the id git hash-object computes", () => {
    expect(gitBlobSha(bytes(""))).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(gitBlobSha(bytes("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});

describe("diffTrees", () => {
  const remote = [
    { path: "README.md", sha: "aaa" },
    { path: "src/app.ts", sha: "bbb" },
    { path: "old.txt", sha: "ccc" },
  ];

  it("classifies added, modified and deleted paths", () => {
    const local = [
      { path: "README.md", sha: "aaa" },
      { path: "src/app.ts", sha: "zzz" },
      { path: "src/new.ts", sha: "ddd" },
    ];
    expect(diffTrees(local, remote)).toEqual({
      added: ["src/new.ts"],
      modified: ["src/app.ts"],
      deleted: ["old.txt"],
    });
  });

  it("is clean when the trees agree", () => {
    expect(isClean(diffTrees(remote, remote))).toBe(true);
    expect(isClean(diffTrees([], remote))).toBe(false);
  });
});
