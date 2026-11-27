import type { JsonValue } from "@facilis.dev/core/runtime-config";

import type { SourceRef } from "./types.ts";

/**
 * The declared `runtime` / `public` sections as static facts (D-224).
 *
 * The state is explicit because a declaration has three outcomes and only one of them carries a
 * value: a literal, the `{ secret: true }` marker (the source is defined, the value is not), or a
 * value outside the static subset (unknown). `unset` is the fourth outcome: the app wrote a key
 * with neither a literal nor a marker, which static evaluation reads as the JavaScript
 * `undefined` value.
 */
export type RuntimeKeyState = "literal" | "secret" | "unknown" | "unset";

export interface RuntimeKeyFact {
  readonly state: RuntimeKeyState;
  /** The literal value; undefined for every other state. */
  readonly value: JsonValue | undefined;
  readonly source: SourceRef;
}

export interface ConfigRuntimeFacts {
  readonly runtime: Readonly<Record<string, RuntimeKeyFact>>;
  readonly public: Readonly<Record<string, RuntimeKeyFact>>;
  /** The section could not be read wholly (a spread or a computed value): never assert "missing". */
  readonly runtimeUnknown: boolean;
  readonly publicUnknown: boolean;
}
