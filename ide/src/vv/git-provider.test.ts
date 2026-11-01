import { describe, expect, it } from "vitest";
import {
  detectGitProvider,
  gitAuthHeaders,
  hostOfGitInput,
  normalizeGitToken,
  parseGitRepo,
} from "./git-provider";

describe("git host selection", () => {
  it("recognises the hosted services and the self-hosted names", () => {
    expect(detectGitProvider("github.com")).toBe("github");
    expect(detectGitProvider("gitlab.com")).toBe("gitlab");
    expect(detectGitProvider("git.company.com")).toBeNull();
    expect(detectGitProvider("gitlab.company.com")).toBe("gitlab");
    expect(detectGitProvider("gitea.com")).toBe("gitea");
    expect(detectGitProvider("forgejo.company.com")).toBe("gitea");
  });

  it("tells a URL from an owner/repo shorthand", () => {
    expect(hostOfGitInput("owner/repo")).toBeNull();
    expect(hostOfGitInput("gitlab.com/group/repo")).toBe("gitlab.com");
    expect(hostOfGitInput("https://gitea.example.com/o/r")).toBe("gitea.example.com");
  });

  it("normalizes a pasted token and refuses non-tokens", () => {
    expect(normalizeGitToken("  ghp_abc  ")).toBe("ghp_abc");
    expect(normalizeGitToken("")).toBeNull();
    expect(normalizeGitToken("two words")).toBeNull();
    expect(normalizeGitToken("x".repeat(256))).toBeNull();
    expect(normalizeGitToken(undefined)).toBeNull();
  });

  it("sends the token the way each host expects it", () => {
    expect(gitAuthHeaders("github", "t")).toEqual({ Authorization: "Bearer t" });
    expect(gitAuthHeaders("gitlab", "t")).toEqual({ "PRIVATE-TOKEN": "t" });
    expect(gitAuthHeaders("gitea", "t")).toEqual({ Authorization: "token t" });
    expect(gitAuthHeaders("github", null)).toEqual({});
  });
});

describe("repository parsing", () => {
  it("parses GitHub shorthands, URLs and refs", () => {
    expect(parseGitRepo("owner/repo")).toMatchObject({
      provider: "github",
      api: "https://api.github.com",
      owner: "owner",
      repo: "repo",
    });
    expect(parseGitRepo("owner/repo@dev")?.ref).toBe("dev");
    expect(parseGitRepo("https://github.com/owner/repo/tree/feat/x")).toMatchObject({
      owner: "owner",
      repo: "repo",
      ref: "feat/x",
    });
    expect(parseGitRepo("https://github.com/owner/repo.git")?.repo).toBe("repo");
  });

  it("parses GitLab, including nested groups and self-hosted hosts", () => {
    expect(parseGitRepo("https://gitlab.com/group/sub/repo/-/tree/main", "gitlab")).toMatchObject({
      provider: "gitlab",
      api: "https://gitlab.com/api/v4",
      owner: "group/sub",
      repo: "repo",
      ref: "main",
    });
    expect(parseGitRepo("group/sub/repo", "gitlab")).toMatchObject({
      api: "https://gitlab.com/api/v4",
      owner: "group/sub",
      repo: "repo",
    });
    expect(parseGitRepo("https://gitlab.company.com/team/repo", "gitlab")).toMatchObject({
      api: "https://gitlab.company.com/api/v4",
      owner: "team",
      repo: "repo",
    });
  });

  it("parses Gitea/Forgejo, including the src/branch permalink", () => {
    expect(
      parseGitRepo("https://gitea.example.com/owner/repo/src/branch/dev", "gitea"),
    ).toMatchObject({
      provider: "gitea",
      api: "https://gitea.example.com/api/v1",
      owner: "owner",
      repo: "repo",
      ref: "dev",
    });
    expect(parseGitRepo("owner/repo", "gitea")).toMatchObject({
      api: "https://gitea.com/api/v1",
    });
  });

  it("refuses a host the selected adapter cannot read", () => {
    // github adapter has fixed api.github.com/raw hosts: a different host would be wrong.
    expect(parseGitRepo("https://gitlab.com/group/repo", "github")).toBeNull();
    expect(parseGitRepo("not a repo")).toBeNull();
    expect(parseGitRepo("   ")).toBeNull();
  });
});
