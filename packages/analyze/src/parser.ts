import type { AstNode } from "./ast/node.ts";
import type { SourceRef } from "./types.ts";

export interface ParseError {
  readonly message: string;
  readonly start: number | null;
  readonly end: number | null;
  readonly source: SourceRef;
}

/** A lexical comment as the parser reports it: offsets into the source text, value without
 * the delimiters. The schema class pass reads the system-only marker from these (D-211). */
export interface SourceComment {
  readonly type: string;
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

export interface ParsedModule {
  readonly program: AstNode;
  readonly errors: readonly ParseError[];
  /** Comments when the parser exposes them; absent means "not readable", never "none". */
  readonly comments?: readonly SourceComment[];
}

/** Injected parser contract: the analyzer never imports a parser package itself. */
export interface Parser {
  parse(filename: string, source: string): ParsedModule;
}
