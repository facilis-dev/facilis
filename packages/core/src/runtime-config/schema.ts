import { z } from "zod";

import type { SecretString } from "./secret-string.ts";

/**
 * The declared shapes of the `runtime` and `public` sections (D-224).
 *
 * Both sections belong to the app: the framework validates the shape and the key syntax, never a
 * fixed key set. A key the app reads is a key the app declares.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** What the file declares for a server key: a literal, or `{ secret: true }`. */
export type FacilisRuntimeDeclaration = JsonValue;
export type FacilisRuntimeDeclarations = Readonly<Record<string, FacilisRuntimeDeclaration>>;
/** What the runtime hands out for a server key: a box for secrets, a literal otherwise. */
export type FacilisRuntimeValue = SecretString | JsonValue;
export type FacilisRuntimeConfig = Readonly<Record<string, FacilisRuntimeValue>>;
export type FacilisPublicConfig = Readonly<Record<string, JsonValue>>;

/** The declaration rule: camelCase starting lowercase, so `FACILIS_` + UPPER_SNAKE is unambiguous. */
export const RUNTIME_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
const KEY_MESSAGE = "keys are camelCase starting with a lowercase letter";

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

export const secretMarkerSchema = z.strictObject({ secret: z.literal(true) });

/** True only for the declaration marker, never for an ordinary object value. */
export function isSecretMarker(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)["secret"] === true
  );
}

export const runtimeSectionSchema = z
  .record(z.string().regex(RUNTIME_KEY_PATTERN, KEY_MESSAGE), jsonValue)
  .default({});

/**
 * Public values ship to the browser, so a secret marker is a shape error: everything in the
 * bundle is public by definition.
 */
export const publicSectionSchema = z
  .record(z.string().regex(RUNTIME_KEY_PATTERN, KEY_MESSAGE), jsonValue)
  .superRefine((section, ctx) => {
    for (const [key, value] of Object.entries(section)) {
      if (isSecretMarker(value)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key}: a public value is baked into the client bundle and can never be a secret`,
        });
      }
    }
  })
  .default({});
