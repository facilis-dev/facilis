import type { AstNode } from "./ast/node.ts";
import type { SourceRef } from "./types.ts";

export interface ParseError {
  readonly message: string;
  readonly start: number | null;
  readonly end: number | null;
  readonly source: SourceRef;
}

export interface ParsedModule {
  readonly program: AstNode;
  readonly errors: readonly ParseError[];
}

/** Injected parser contract: the analyzer never imports a parser package itself. */
export interface Parser {
  parse(filename: string, source: string): ParsedModule;
}
