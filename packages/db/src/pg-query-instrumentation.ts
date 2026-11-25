/**
 * Driver-level query spans for the Postgres client (D-203 §1, D-068).
 *
 * The wrapper sits on `pg.Pool`/`pg.Client` and wraps only `query` (and the clients
 * `connect` hands out), because that is the single place every statement the framework's
 * Drizzle client runs passes through. It reports a descriptor — verb and relation — so the
 * statement text, its bind values and the connection URL never leave this module.
 */
import { describeStatement } from "./describe-statement.ts";
import { currentQueryTrace } from "./query-trace.ts";

type AnyFunction = (...args: unknown[]) => unknown;

/**
 * Wraps a pool or client so its queries are announced to the active trace. Methods are bound
 * to the original object because `pg` classes rely on `this` (and on being EventEmitters).
 */
export function instrumentPostgresClient<T extends object>(target: T): T {
  return new Proxy(target, {
    get(object, property) {
      const value: unknown = Reflect.get(object, property);
      if (typeof value !== "function") return value;
      if (property === "query") return tracedQuery(object, value as AnyFunction);
      if (property === "connect") return tracedConnect(object, value as AnyFunction);
      // Binding keeps every other method (end, release, event emitter hooks) usable.
      return (value as AnyFunction).bind(object);
    },
  });
}

function tracedQuery(target: object, query: AnyFunction): AnyFunction {
  return (...args: unknown[]) => {
    const trace = currentQueryTrace();
    // No framework trace: the wrapper costs one lookup and forwards exactly as before.
    if (trace === undefined) return query.apply(target, args);
    const span = trace.startQuerySpan(describeStatement(statementOf(args[0])));
    let result: unknown;
    try {
      result = query.apply(target, args);
    } catch (error) {
      span.end(error);
      throw error;
    }
    if (!isThenable(result)) {
      span.end();
      return result;
    }
    return result.then(
      (value: unknown) => {
        span.end();
        return value;
      },
      (error: unknown) => {
        span.end(error);
        throw error;
      },
    );
  };
}

/**
 * `connect()` returns a client that runs the transaction's statements directly, so it has to
 * be wrapped too. The callback form returns no promise; the promise form is what Drizzle uses.
 */
function tracedConnect(target: object, connect: AnyFunction): AnyFunction {
  return (...args: unknown[]) => {
    const result = connect.apply(target, args);
    if (!isThenable(result)) return result;
    return result.then((client: unknown) =>
      isObject(client) ? instrumentPostgresClient(client) : client,
    );
  };
}

/** pg takes a statement string, or a config object whose `text` is the statement. */
function statementOf(first: unknown): string {
  if (typeof first === "string") return first;
  if (isObject(first)) {
    const text = (first as { readonly text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return isObject(value) && typeof (value as { readonly then?: unknown }).then === "function";
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
