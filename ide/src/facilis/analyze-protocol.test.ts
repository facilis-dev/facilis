import { describe, expect, it } from "vitest";
import {
  isAnalysis,
  isAnalyzeRequest,
  isErrorMessage,
  isReadyMessage,
  isResultMessage,
  toAnalyzeRequest,
} from "./analyze-protocol";

const EMPTY_ANALYSIS = {
  revision: "rev",
  files: [],
  config: {},
  locales: {},
  routes: [],
  tables: [],
  relations: [],
  pages: [],
  diagnostics: [],
  graph: { nodes: [], edges: [] },
};

describe("toAnalyzeRequest", () => {
  it("serializes the snapshot as [path, source] pairs", () => {
    const request = toAnalyzeRequest(
      new Map([
        ["src/app.tsx", "export const a = 1;"],
        ["facilis.config.ts", "export default {};"],
      ]),
    );
    expect(request).toEqual({
      type: "analyze",
      files: [
        ["src/app.tsx", "export const a = 1;"],
        ["facilis.config.ts", "export default {};"],
      ],
    });
    expect(isAnalyzeRequest(request)).toBe(true);
  });
});

describe("isAnalyzeRequest", () => {
  it("rejects malformed requests", () => {
    for (const value of [
      null,
      "analyze",
      {},
      { type: "analyze" },
      { type: "analyze", files: "src/app.tsx" },
      { type: "analyze", files: [["src/app.tsx"]] },
      { type: "analyze", files: [["src/app.tsx", 1]] },
      { type: "result", files: [] },
    ]) {
      expect(isAnalyzeRequest(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe("worker message guards", () => {
  it("narrows the ready message", () => {
    expect(isReadyMessage({ type: "ready" })).toBe(true);
    expect(isReadyMessage({ type: "ready", extra: 1 })).toBe(true);
    expect(isReadyMessage({ type: "result" })).toBe(false);
    expect(isReadyMessage(null)).toBe(false);
  });

  it("narrows the error message", () => {
    expect(isErrorMessage({ type: "error", message: "boom" })).toBe(true);
    expect(isErrorMessage({ type: "error" })).toBe(false);
    expect(isErrorMessage({ type: "error", message: 1 })).toBe(false);
  });

  it("accepts a structurally sound analysis", () => {
    expect(isAnalysis(EMPTY_ANALYSIS)).toBe(true);
    expect(isResultMessage({ type: "result", analysis: EMPTY_ANALYSIS })).toBe(true);
  });

  it("rejects an analysis with missing or mistyped fields", () => {
    const cases = [
      { ...EMPTY_ANALYSIS, revision: 1 },
      { ...EMPTY_ANALYSIS, files: "src/app.tsx" },
      { ...EMPTY_ANALYSIS, config: null },
      { ...EMPTY_ANALYSIS, locales: [] },
      { ...EMPTY_ANALYSIS, routes: {} },
      { ...EMPTY_ANALYSIS, tables: null },
      { ...EMPTY_ANALYSIS, graph: null },
      { ...EMPTY_ANALYSIS, graph: { nodes: [] } },
    ];
    for (const analysis of cases) {
      expect(isAnalysis(analysis), JSON.stringify(analysis)).toBe(false);
      expect(isResultMessage({ type: "result", analysis })).toBe(false);
    }
    expect(isResultMessage({ type: "result" })).toBe(false);
    expect(isResultMessage("result")).toBe(false);
  });
});
