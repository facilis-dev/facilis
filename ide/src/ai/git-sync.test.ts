import { describe, expect, it } from "vitest";
import { createGitAccessFromPorts } from "./git-access";
import { change, fakePorts, viewOf } from "./git-access-fixtures";

describe("git_sync", () => {
  it("needs the signed-in GitHub account and refuses a dirty pull as data", async () => {
    const anonymous = fakePorts({ token: null });
    const refused = await viewOf(createGitAccessFromPorts(anonymous.ports).sync("push"));
    expect(refused.available).toBe(false);
    expect(refused.reason).toContain("sign in to GitHub");
    expect(anonymous.calls.filter((call) => call.startsWith("push"))).toEqual([]);
    const gitlab = fakePorts({
      remotes: [{ remote: "origin", url: "https://gitlab.com/acme/app.git" }],
    });
    expect(await viewOf(createGitAccessFromPorts(gitlab.ports).sync("fetch"))).toMatchObject({
      available: false,
    });
    const dirty = fakePorts({ repo: { changes: [change("src/a.ts")] } });
    const pull = await viewOf(createGitAccessFromPorts(dirty.ports).sync("pull"));
    expect(pull).toMatchObject({ ok: false });
    expect(pull.reason).toContain("uncommitted changes");
    expect(dirty.calls).not.toContain("pull");
    const push = fakePorts();
    expect(await viewOf(createGitAccessFromPorts(push.ports).sync("push"))).toMatchObject({
      ok: true,
      action: "push",
    });
    expect(push.calls).toContain("push:gh-token");
  });
});

describe("git_pull_request", () => {
  it("opens a GitHub pull request and never exposes the token", async () => {
    let url = "";
    let auth = "";
    let body = "";
    const fake = fakePorts({
      repo: { currentBranch: "feature/x" },
      fetchApi: async (input, init) => {
        url = input;
        auth = String((init.headers as Record<string, string>)["Authorization"]);
        body = String(init.body);
        return new Response(
          JSON.stringify({ number: 7, html_url: "https://github.com/acme/app/pull/7" }),
          { status: 201 },
        );
      },
    });
    const view = await viewOf(
      createGitAccessFromPorts(fake.ports).pullRequest({
        title: "Add x",
        body: "why",
        draft: true,
      }),
    );
    expect(view).toMatchObject({ ok: true, number: 7, url: "https://github.com/acme/app/pull/7" });
    expect(url).toBe("https://api.github.com/repos/acme/app/pulls");
    expect(url).not.toContain("gh-token");
    expect(auth).toBe("Bearer gh-token");
    expect(JSON.parse(body)).toMatchObject({
      title: "Add x",
      base: "main",
      head: "feature/x",
      draft: true,
    });
    expect(JSON.stringify(view)).not.toContain("gh-token");
  });

  it("explains provider, sign-in and HTTP failures as guidance", async () => {
    const gitlab = fakePorts({
      remotes: [{ remote: "origin", url: "https://gitlab.com/acme/app.git" }],
    });
    expect(
      await viewOf(createGitAccessFromPorts(gitlab.ports).pullRequest({ title: "x" })),
    ).toMatchObject({ available: false });
    const anonymous = fakePorts({ token: null });
    expect(
      (await viewOf(createGitAccessFromPorts(anonymous.ports).pullRequest({ title: "x" }))).reason,
    ).toContain("sign in to GitHub");
    const rejected = fakePorts({
      repo: { currentBranch: "feature/x" },
      fetchApi: async () => new Response(null, { status: 422 }),
    });
    const view = await viewOf(createGitAccessFromPorts(rejected.ports).pullRequest({ title: "x" }));
    expect(view.ok).toBe(false);
    expect(view.reason).toContain("HTTP 422");
  });
});
