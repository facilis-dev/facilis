// The live design eval (DESIGN.md §11 P3): the six cases in design-eval.ts, sent through the
// chat's own system prompt, scored by the pure rubric. Opt-in twice — DESIGN_EVAL=1 and a real
// key — so a normal test run never spends tokens even when ide/.env is populated.
//
//   DESIGN_EVAL=1 pnpm ai:eval
//
// No node imports on purpose: the suite runs inside the IDE's own module graph, so it reads the
// template through the same inlined sources the IDE ships, and prints the report to the console.

import { describe, expect, it } from "vitest";
import { todoExampleSources } from "@/facilis/example-template";
import { DESIGN_EVAL_CASES, scoreDesignAnswer } from "./design-eval";
import { parseDesignAnswer, summarizeDesignEval, type DesignEvalRow } from "./design-eval-report";
import { buildSystemPrompt } from "./prompt";

const ENABLED = import.meta.env.VITE_DESIGN_EVAL === "1";
const SEEDS = Number(import.meta.env.VITE_DESIGN_EVAL_SEEDS ?? "3");
const MODEL = import.meta.env.VITE_DEEPSEEK_MODEL || "deepseek-chat";
const BASE = (import.meta.env.VITE_DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(
  /\/+$/,
  "",
);

describe.skipIf(!ENABLED)("design eval (live)", () => {
  it(
    "scores every case against the model",
    async () => {
      const key = (import.meta.env.VITE_DEEPSEEK_API_KEY ?? "").trim();
      expect(key, "VITE_DEEPSEEK_API_KEY is empty: put it in ide/.env").not.toBe("");

      const { files, packageJson } = todoExampleSources();
      const pkg = JSON.parse(packageJson) as { dependencies?: Record<string, string> };
      const deps = new Set(Object.keys(pkg.dependencies ?? {}));
      const system = buildSystemPrompt({
        manifest: null,
        manifestRevision: null,
        files: Object.keys(files),
        activeFile: null,
        configFile: {
          path: "facilis.config.ts",
          content: files["facilis.config.ts"] ?? "",
        },
        instructions: null,
        designFile: { path: "DESIGN.md", content: files["DESIGN.md"] ?? "" },
        tools: [],
        writePolicy: "open",
      });

      const rows: DesignEvalRow[] = [];
      for (const entry of DESIGN_EVAL_CASES) {
        for (let seed = 1; seed <= SEEDS; seed += 1) {
          const started = Date.now();
          const response = await fetch(BASE + "/chat/completions", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer " + key },
            body: JSON.stringify({
              model: MODEL,
              messages: [
                { role: "system", content: system },
                { role: "user", content: entry.prompt },
              ],
              stream: false,
              max_tokens: 8192,
            }),
            signal: AbortSignal.timeout(5 * 60 * 1000),
          });
          expect(response.ok, "provider " + response.status).toBe(true);
          const payload = (await response.json()) as {
            choices?: { message?: { content?: string } }[];
            usage?: { completion_tokens?: number };
          };
          const answer = parseDesignAnswer(payload.choices?.[0]?.message?.content ?? "");
          rows.push({
            case: entry.id,
            seed,
            ms: Date.now() - started,
            tokens: payload.usage?.completion_tokens ?? 0,
            score:
              answer === null || !Array.isArray(answer.patches)
                ? null
                : scoreDesignAnswer(answer.patches, deps),
          });
        }
      }

      console.log(summarizeDesignEval(rows, { model: MODEL, seeds: SEEDS }));
      expect(rows).toHaveLength(DESIGN_EVAL_CASES.length * SEEDS);
      // Every case must at least produce parseable patches; the rubric reports the rest.
      expect(rows.filter((row) => row.score === null)).toHaveLength(0);
    },
    30 * 60 * 1000,
  );
});
