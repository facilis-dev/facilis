import { parseSync } from "oxc-parser";

import { analyzeProject, type AnalyzeInput } from "./analyze.ts";
import { asNode } from "./ast/node.ts";
import type { PathAlias } from "./path-resolver.ts";
import { loadProjectFiles, type LoadProjectOptions } from "./fs.ts";
import type { ParseError, Parser } from "./parser.ts";
import { lineOf } from "./source.ts";
import type { Analysis } from "./types.ts";

/** Node/CI parser adapter. The browser uses a wasm adapter over the same contract. */
export function createOxcParser(): Parser {
  return {
    parse(filename: string, source: string) {
      const result = parseSync(filename, source, {
        astType: "ts",
        sourceType: "module",
        preserveParens: true,
      });
      const program = asNode(result.program as unknown);
      if (program === undefined) throw new Error("oxc-parser returned no program");
      const errors: ParseError[] = result.errors.map((error) => {
        const label = error.labels[0];
        const start = label === undefined ? null : label.start;
        return {
          message: error.message,
          start,
          end: label === undefined ? null : label.end,
          source: { file: filename, line: start === null ? 1 : lineOf(source, start) },
        };
      });
      return { program, errors };
    },
  };
}

export interface AnalyzeDirectoryOptions {
  readonly aliases?: readonly PathAlias[];
  readonly transport?: AnalyzeInput["transport"];
  readonly load?: LoadProjectOptions;
}

export { loadProjectFiles } from "./fs.ts";
export type { LoadProjectOptions } from "./fs.ts";

/** Convenience for Node/CI: load a directory and analyze it. The browser passes its own map. */
export function analyzeDirectory(root: string, options: AnalyzeDirectoryOptions = {}): Analysis {
  return analyzeProject({
    files: loadProjectFiles(root, options.load),
    parser: createOxcParser(),
    ...(options.aliases === undefined ? {} : { aliases: options.aliases }),
    ...(options.transport === undefined ? {} : { transport: options.transport }),
  });
}
