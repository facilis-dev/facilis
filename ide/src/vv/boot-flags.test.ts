import { describe, expect, it } from "vitest";
import { parseBootFlags } from "./boot-flags";

describe("parseBootFlags", () => {
  it("leaves every lever on by default", () => {
    expect(parseBootFlags("")).toEqual({});
    expect(parseBootFlags("?project=/home/user/p")).toEqual({});
  });

  it("turns the named lever off", () => {
    expect(parseBootFlags("?boot=-mirrorLane")).toEqual({ mirrorLane: false });
    expect(parseBootFlags("?boot=-deferCacheFiles,-mirrorLane")).toEqual({
      deferCacheFiles: false,
      mirrorLane: false,
    });
  });

  it("can turn one back on explicitly, which is what a bisect needs", () => {
    expect(parseBootFlags("?boot=-deferRestoreRoots,deferRestoreRoots")).toEqual({
      deferRestoreRoots: true,
    });
  });

  it("knows the dependency-cache lever", () => {
    expect(parseBootFlags("?boot=-depCache")).toEqual({ depCache: false });
  });

  it("ignores names it does not know, and a bare dash", () => {
    expect(parseBootFlags("?boot=-nope,-")).toEqual({});
  });
});
