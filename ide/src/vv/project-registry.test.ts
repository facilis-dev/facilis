import { describe, expect, it } from "vitest";
import { PROJECTS_KEY, readRegistry, writeRegistry, type ProjectMeta } from "./project-registry";

// The registry is shared by every tab of the origin. These cases are the cross-tab
// failure that lost a project: one tab writes the list it knows, the other's entry
// must survive it.
function fakeStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(PROJECTS_KEY, initial);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    raw: () => data.get(PROJECTS_KEY) ?? null,
  };
}

const project = (name: string, lastModified: number): ProjectMeta => ({
  name,
  rootPath: "/home/user/projects/" + name,
  template: "react-ts",
  createdAt: 1,
  lastModified,
});

describe("recent-projects registry", () => {
  it("merges a write into what other tabs stored instead of replacing it", () => {
    const storage = fakeStorage(JSON.stringify([project("alpha", 10)]));
    const merged = writeRegistry(storage, { upsert: [project("beta", 20)] });
    expect(merged.map((p) => p.name)).toEqual(["beta", "alpha"]);
    expect(readRegistry(storage).map((p) => p.name)).toEqual(["beta", "alpha"]);
  });

  it("removes only the paths it was asked to remove", () => {
    const storage = fakeStorage(JSON.stringify([project("alpha", 10), project("beta", 20)]));
    const merged = writeRegistry(storage, { remove: ["/home/user/projects/alpha"] });
    expect(merged.map((p) => p.name)).toEqual(["beta"]);
    expect(readRegistry(storage).map((p) => p.name)).toEqual(["beta"]);
  });

  it("keeps the newer timestamp when two tabs touched the same project", () => {
    const storage = fakeStorage(JSON.stringify([project("alpha", 10)]));
    writeRegistry(storage, { upsert: [project("alpha", 5)] });
    expect(readRegistry(storage)).toEqual([project("alpha", 10)]);
  });

  it("recovers from unreadable storage instead of throwing", () => {
    expect(readRegistry(fakeStorage("{not json"))).toEqual([]);
    expect(readRegistry(fakeStorage(JSON.stringify([{ name: "x" }])))).toEqual([]);
    expect(readRegistry(fakeStorage(JSON.stringify({ nope: true })))).toEqual([]);
  });

  it("normalises a legacy entry instead of dropping the whole list", () => {
    const storage = fakeStorage(JSON.stringify([{ name: "old", rootPath: "/p" }]));
    const [entry] = readRegistry(storage);
    expect(entry.name).toBe("old");
    expect(entry.template).toBeNull();
    expect(typeof entry.lastModified).toBe("number");
  });
});
