/**
 * A secret value that cannot leak by accident (D-224).
 *
 * The resolved runtime config exposes secrets as boxes, never as bare strings: `reveal()` is the
 * only way to obtain the value, while JSON serialization, string interpolation and the Node
 * inspector all answer "[redacted]". A debug log, an error payload or a manifest dump therefore
 * cannot carry a credential by accident.
 */
export const REDACTED = "[redacted]";

// Node's inspector consults this global symbol. Referencing it instead of importing node:util
// keeps @facilis.dev/core loadable in the browser, where the module is also consumed.
const INSPECT = Symbol.for("nodejs.util.inspect.custom");

export class SecretString {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
    Object.freeze(this);
  }

  /** The only way to read the secret: keep the call at the point that actually needs the value. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }
}

Object.defineProperty(SecretString.prototype, INSPECT, {
  value: function redactedInspect(): string {
    return REDACTED;
  },
  enumerable: false,
});
