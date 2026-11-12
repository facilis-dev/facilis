import { describe, expect, it } from "vitest";
import {
  detectGitProvider,
  gitAuthHeaders,
  gitAuthTarget,
  hostOfGitInput,
  normalizeGitSecret,
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

  it("reads the same field as a password when a username was given", () => {
    // Account passwords are not token-shaped: a self-hosted host may accept one with
    // spaces or punctuation (D-081).
    expect(normalizeGitSecret("  s3cret pass  ", true)).toBe("s3cret pass");
    expect(normalizeGitSecret("two words", true)).toBe("two words");
    expect(normalizeGitSecret("two words", false)).toBeNull();
    expect(normalizeGitSecret("ghp_abc", true)).toBe("ghp_abc");
    expect(normalizeGitSecret("", true)).toBeNull();
    expect(normalizeGitSecret("x".repeat(256), true)).toBeNull();
    expect(normalizeGitSecret(undefined, true)).toBeNull();
  });

  it("sends the token the way each host expects it", () => {
    expect(gitAuthHeaders("github", "t")).toEqual({ Authorization: "Bearer t" });
    expect(gitAuthHeaders("gitlab", "t")).toEqual({ "PRIVATE-TOKEN": "t" });
    expect(gitAuthHeaders("gitea", "t")).toEqual({ Authorization: "token t" });
    expect(gitAuthHeaders("github", null)).toEqual({});
  });
});

describe("git auth target", () => {
  it("asks for the GitHub device flow for a shorthand or a github.com URL", () => {
    expect(gitAuthTarget("owner/repo")).toEqual({ kind: "github" });
    expect(gitAuthTarget("github.com/owner/repo")).toEqual({ kind: "github" });
    expect(gitAuthTarget("https://github.com/owner/repo.git")).toEqual({ kind: "github" });
  });

  it("asks for a token, naming the host when the editor knows the provider", () => {
    expect(gitAuthTarget("https://gitlab.com/group/repo")).toEqual({
      kind: "token",
      provider: "gitlab",
    });
    expect(gitAuthTarget("gitea.com/owner/repo")).toEqual({ kind: "token", provider: "gitea" });
    // A self-hosted GitLab still gets GitLab's label (and its token header).
    expect(gitAuthTarget("https://gitlab.company.com/team/repo")).toEqual({
      kind: "token",
      provider: "gitlab",
    });
  });

  it("asks for a token with no provider for any other host", () => {
    expect(gitAuthTarget("https://git.company.com/team/repo")).toEqual({
      kind: "token",
      provider: null,
    });
    expect(gitAuthTarget("git.company.com/team/repo")).toEqual({
      kind: "token",
      provider: null,
    });
  });

  it("has no auth target before the user typed a repository", () => {
    expect(gitAuthTarget("")).toBeNull();
    expect(gitAuthTarget("   ")).toBeNull();
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
