import { describe, expect, it } from "vitest";

import { createDb } from "./index";

describe("createDb", () => {
  it("defaults to the in-browser PGlite driver", async () => {
    const db = createDb();

    expect(db.driver).toBe("pglite");
    await expect(db.close()).resolves.toBeUndefined();
  });

  it("accepts an explicit postgres driver", () => {
    const db = createDb({ driver: "postgres", url: "postgres://localhost/facilis" });

    expect(db.driver).toBe("postgres");
  });
});
