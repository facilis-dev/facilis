export function run(code: string): unknown {
  // oxlint-disable-next-line no-eval -- the fixture must contain dynamic code for the gate.
  return eval(code);
}
