import { describe, expect, it } from "vitest";

import {
  approvalMatches,
  parseReleaseArtifact,
  RELEASE_ARTIFACT_FORMAT_VERSION,
  sealReleaseArtifact,
  type ReleaseArtifactInput,
} from "./release-artifact.ts";

const FROM_DIGEST = "v1:sha256:1111111111111111111111111111111111111111111111111111111111111111";
const TO_DIGEST = "v1:sha256:2222222222222222222222222222222222222222222222222222222222222222";

/** Golden plan hash: frozen so any change in the hashed body surface fails loudly. */
const GOLDEN_PLAN_HASH = "sha256:2e009418c3c92a79d14663398a1527aa62bf26a146f1574152674eb515d79859";

function goldenInput(): ReleaseArtifactInput {
  return {
    formatVersion: 1,
    tag: "v1.4.0",
    from: {
      tag: "v1.3.0",
      oid: "0f3a1c9d2b7e4568a9c0d1e2f3a4b5c6d7e8f901",
    },
    to: {
      tag: "v1.4.0",
      oid: "1a2b3c4d5e6f70819273a4b5c6d7e8f901a2b3c4",
    },
    digestVersion: 1,
    fromDigest: FROM_DIGEST,
    toDigest: TO_DIGEST,
    risk: "destructive",
    destructive: ["0002"],
    batches: [
      {
        id: "0001",
        kind: "ddl",
        sql: 'ALTER TABLE "todos" ADD COLUMN "due_date" timestamp with time zone;',
        risk: "safe",
      },
      {
        id: "0002",
        kind: "ddl",
        sql: 'ALTER TABLE "todos" DROP COLUMN "note";',
        risk: "destructive",
        requires: ["todos.note:0"],
      },
    ],
    problems: [],
    generatedBy: "facilis-release@0.0.0",
    generatedAt: "2026-11-10T00:00:00.000Z",
  };
}

/** The same body with every object's keys written in a different order. */
function goldenInputReordered(): ReleaseArtifactInput {
  return {
    generatedAt: "2026-11-10T00:00:00.000Z",
    generatedBy: "facilis-release@0.0.0",
    problems: [],
    batches: [
      {
        risk: "safe",
        sql: 'ALTER TABLE "todos" ADD COLUMN "due_date" timestamp with time zone;',
        kind: "ddl",
        id: "0001",
      },
      {
        requires: ["todos.note:0"],
        risk: "destructive",
        sql: 'ALTER TABLE "todos" DROP COLUMN "note";',
        kind: "ddl",
        id: "0002",
      },
    ],
    destructive: ["0002"],
    risk: "destructive",
    toDigest: TO_DIGEST,
    fromDigest: FROM_DIGEST,
    digestVersion: 1,
    to: { oid: "1a2b3c4d5e6f70819273a4b5c6d7e8f901a2b3c4", tag: "v1.4.0" },
    from: { oid: "0f3a1c9d2b7e4568a9c0d1e2f3a4b5c6d7e8f901", tag: "v1.3.0" },
    tag: "v1.4.0",
    formatVersion: 1,
  };
}

describe("release artifact", () => {
  it("seals the golden artifact to a stable hash and round-trips through the parser", async () => {
    const artifact = await sealReleaseArtifact(goldenInput());

    expect(RELEASE_ARTIFACT_FORMAT_VERSION).toBe(1);
    expect(artifact.planHash).toBe(GOLDEN_PLAN_HASH);
    const parsed = parseReleaseArtifact(artifact);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("golden artifact did not parse");
    expect(parsed.artifact).toEqual(artifact);
  });

  it("hashes the same body identically whatever the object key order", async () => {
    const artifact = await sealReleaseArtifact(goldenInputReordered());

    expect(artifact.planHash).toBe(GOLDEN_PLAN_HASH);
  });

  it("excludes provenance and the approval from the hash", async () => {
    const sealed = await sealReleaseArtifact({
      ...goldenInput(),
      generatedBy: "nightly-ci@0.0.1",
      generatedAt: "2026-11-11T12:34:56.000Z",
      approved: { by: "release-manager", at: "2026-11-11T13:00:00.000Z", hash: GOLDEN_PLAN_HASH },
    });

    expect(sealed.planHash).toBe(GOLDEN_PLAN_HASH);
  });

  it("changes the hash when one SQL byte, the risk class or the destructive list changes", async () => {
    const [firstBatch, ...laterBatches] = goldenInput().batches;
    if (firstBatch === undefined) throw new Error("golden batch missing");
    const changedSql = await sealReleaseArtifact({
      ...goldenInput(),
      // One added byte in the SQL text; the body is otherwise identical.
      batches: [{ ...firstBatch, sql: `${firstBatch.sql} ` }, ...laterBatches],
    });
    const changedRisk = await sealReleaseArtifact({ ...goldenInput(), risk: "safe" });
    const changedDestructive = await sealReleaseArtifact({
      ...goldenInput(),
      destructive: ["0001"],
    });

    expect(changedSql.planHash).not.toBe(GOLDEN_PLAN_HASH);
    expect(changedRisk.planHash).not.toBe(GOLDEN_PLAN_HASH);
    expect(changedDestructive.planHash).not.toBe(GOLDEN_PLAN_HASH);
  });

  it("binds the approval to the plan hash", async () => {
    const sealed = await sealReleaseArtifact(goldenInput());

    expect(approvalMatches(sealed)).toBe(false);
    expect(
      approvalMatches({
        ...sealed,
        approved: { by: "release-manager", at: "2026-11-11T13:00:00.000Z", hash: sealed.planHash },
      }),
    ).toBe(true);
    expect(
      approvalMatches({
        ...sealed,
        approved: { by: "release-manager", at: "2026-11-11T13:00:00.000Z", hash: TO_DIGEST },
      }),
    ).toBe(false);
    expect(approvalMatches({ ...sealed, planHash: "sha256:not-a-hash" })).toBe(false);
  });

  it("rejects invalid input with machine issues, never prose", async () => {
    const base = await sealReleaseArtifact(goldenInput());

    const empty = parseReleaseArtifact({});
    expect(empty.ok).toBe(false);
    if (empty.ok) throw new Error("empty input should not parse");
    expect(empty.issues.map((issue) => Object.keys(issue).toSorted().join())).toEqual(
      empty.issues.map(() => "code,path"),
    );

    const wrongVersion = parseReleaseArtifact({ ...base, formatVersion: 2 });
    expect(wrongVersion.ok).toBe(false);
    if (wrongVersion.ok) throw new Error("formatVersion 2 should not parse");
    expect(wrongVersion.issues.some((issue) => issue.path === "formatVersion")).toBe(true);

    for (const changed of [
      { ...base, risk: "wildly_destructive" },
      { ...base, fromDigest: "sha256:deadbeef" },
      { ...base, digestVersion: 2 },
      { ...base, unexpected: true },
      { ...base, batches: [{ id: "0001", kind: "ddl", risk: "safe" }] },
    ]) {
      expect(parseReleaseArtifact(changed).ok).toBe(false);
    }

    await expect(
      sealReleaseArtifact({ ...goldenInput(), risk: "wildly_destructive" as never }),
    ).rejects.toThrow("release_artifact_invalid");
  });
});
