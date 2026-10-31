import { describe, expect, it } from "vitest";
import { recoverHostfulFileUrl } from "./file-url-recovery";

// The misparse this shim exists for: Chromium on Windows reads file:/home/user/x as if "home"
// were the URL host (kele23/vivari#2). A host cannot mean a file host in the VM, so the first
// path segment is recovered instead of losing /home.
describe("recoverHostfulFileUrl", () => {
  it("restores the first path segment a misparsing browser promoted to host", () => {
    expect(recoverHostfulFileUrl("file://home/user/projects/x/node_modules/a.data")).toBe(
      "/home/user/projects/x/node_modules/a.data",
    );
  });

  it("leaves an empty-host file URL alone", () => {
    expect(recoverHostfulFileUrl("file:///home/user/x")).toBeNull();
  });

  it("leaves localhost and non-file URLs alone", () => {
    expect(recoverHostfulFileUrl("file://localhost/home/x")).toBeNull();
    expect(recoverHostfulFileUrl("https://example.com/home/x")).toBeNull();
  });
});
