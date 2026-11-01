// The host each provider preset talks to, keyed by preset id.
//
// Duplicated from ide/src/ai/providers.ts on purpose: the build (tsconfig.node, nodenext)
// cannot typecheck that module's extensionless imports, and the deployment artifacts need
// the hosts before the app is bundled. provider-hosts.test.ts keeps the two in lockstep.

export const PROVIDER_BASE_URLS: Readonly<Record<string, string>> = Object.freeze({
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com/v1",
});
