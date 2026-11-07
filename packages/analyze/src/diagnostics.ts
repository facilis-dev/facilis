import type { Diagnostic, Severity, SourceRef } from "./types.ts";

export function diagnostic(
  code: string,
  severity: Severity,
  message: string,
  source: SourceRef | null,
): Diagnostic {
  return { code, severity, message, source };
}

export function error(code: string, message: string, source: SourceRef | null): Diagnostic {
  return diagnostic(code, "error", message, source);
}

export function warning(code: string, message: string, source: SourceRef | null): Diagnostic {
  return diagnostic(code, "warning", message, source);
}

export function info(code: string, message: string, source: SourceRef | null): Diagnostic {
  return diagnostic(code, "info", message, source);
}
