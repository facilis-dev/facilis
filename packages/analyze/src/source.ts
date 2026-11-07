import type { SourceRef } from "./types.ts";

/** 1-based line number of a source offset. */
export function lineOf(source: string, offset: number): number {
  let line = 1;
  const end = Math.min(Math.max(offset, 0), source.length);
  for (let index = 0; index < end; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

export function sourceRef(file: string, source: string, offset: number): SourceRef {
  return { file, line: lineOf(source, offset) };
}
