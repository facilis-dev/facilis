import { describe, expect, it } from "vitest";

import {
  buildSignedDownloadUrl,
  signDownloadToken,
  verifyDownloadToken,
  type FileTokenPayload,
} from "./index.ts";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;
const payload: FileTokenPayload = {
  fileId: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  subject: "user-1",
  expiresAt: NOW + 60_000,
};

describe("signed download tokens", () => {
  it("round-trips a valid token", () => {
    const token = signDownloadToken(payload, SECRET);
    expect(verifyDownloadToken(token, SECRET, NOW)).toEqual(payload);
  });

  it("refuses a tampered body or a wrong secret", () => {
    const token = signDownloadToken(payload, SECRET);
    const [body, signature] = token.split(".");
    const tampered = Buffer.from(
      JSON.stringify({ ...payload, tenantId: "33333333-3333-3333-3333-333333333333" }),
    ).toString("base64url");
    expect(verifyDownloadToken(tampered + "." + signature, SECRET, NOW)).toBeNull();
    expect(verifyDownloadToken(body + "." + signature, "other-secret", NOW)).toBeNull();
    expect(verifyDownloadToken("garbage", SECRET, NOW)).toBeNull();
  });

  it("refuses an expired token", () => {
    const token = signDownloadToken({ ...payload, expiresAt: NOW - 1 }, SECRET);
    expect(verifyDownloadToken(token, SECRET, NOW)).toBeNull();
  });

  it("builds a proxy URL with the token attached", () => {
    const url = buildSignedDownloadUrl({
      fileId: payload.fileId,
      secret: SECRET,
      expiresInSeconds: 60,
      tenantId: payload.tenantId,
      now: NOW,
    });
    expect(url.startsWith("/api/files/")).toBe(true);
    const token = new URLSearchParams(url.split("?")[1]).get("token");
    expect(token).not.toBeNull();
    expect(verifyDownloadToken(token ?? "", SECRET, NOW)?.fileId).toBe(payload.fileId);
  });
});
