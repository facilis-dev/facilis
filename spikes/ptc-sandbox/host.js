// Host page for the PTC sandbox spike: drives the isolation matrix and exposes the
// result on window.__PTC_SPIKE__. Throwaway code (spikes/ is never shipped).

const checks = [];
const record = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: String(detail ?? "") });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs inside the opaque-origin iframe as a blob Worker.
const WORKER_SOURCE = [
  "self.onmessage = () => {",
  "  const report = {};",
  "  try { localStorage.setItem(\"spike\", \"1\"); report.localStorage = \"available\"; } catch { report.localStorage = \"blocked\"; }",
  "  try { indexedDB.open(\"spike\"); report.indexedDB = \"available\"; } catch { report.indexedDB = \"blocked\"; }",
  "  const opfs = (typeof navigator !== \"undefined\" && navigator.storage && navigator.storage.getDirectory)",
  "    ? navigator.storage.getDirectory().then(() => \"available\", () => \"blocked\")",
  "    : Promise.resolve(\"absent\");",
  "  const net = fetch(\"http://127.0.0.1:9/spike\").then(() => \"allowed\", () => \"blocked\");",
  "  Promise.all([opfs, net]).then(([o, n]) => { report.opfs = o; report.fetch = n; self.postMessage(report); });",
  "};",
].join("\n");

// The opaque iframe bootstrap: local probes, tool RPC, worker probes.
const bootstrapScript = [
  "const pending = new Map();",
  "let seq = 0;",
  "const workerSource = " + JSON.stringify(WORKER_SOURCE) + ";",
  "const post = (msg) => parent.postMessage(msg, \"*\");",
  "const tools = { echo: (args) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); post({ type: \"tool\", id, method: \"echo\", args }); }) };",
  "addEventListener(\"message\", (event) => {",
  "  const data = event.data;",
  "  if (!data || data.type !== \"tool-result\") return;",
  "  const resolve = pending.get(data.id);",
  "  if (resolve === undefined) return;",
  "  pending.delete(data.id); resolve(data.value);",
  "});",
  "const report = {};",
  "(async () => {",
  "  try { void parent.document.body; report.parentDom = \"readable\"; } catch { report.parentDom = \"blocked\"; }",
  "  try { localStorage.setItem(\"spike\", \"1\"); report.localStorage = \"available\"; } catch { report.localStorage = \"blocked\"; }",
  "  try { indexedDB.open(\"spike\"); report.indexedDB = \"available\"; } catch { report.indexedDB = \"blocked\"; }",
  "  try { await navigator.storage.getDirectory(); report.opfs = \"available\"; } catch { report.opfs = \"blocked\"; }",
  "  try { await fetch(location.origin + \"/ping\"); report.fetch = \"allowed\"; } catch { report.fetch = \"blocked\"; }",
  "  const echoed = await tools.echo({ value: 42 });",
  "  report.rpc = echoed && echoed.value === 42 ? \"ok\" : \"bad\";",
  "  report.origin = String(location.origin);",
  "  report.worker = await probeWorker();",
  "  report.workerTermination = await probeWorkerTermination();",
  "  post({ type: \"probe\", report });",
  "})();",
  "function probeWorker() {",
  "  return new Promise((resolve) => {",
  "    let worker;",
  "    try { worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: \"text/javascript\" }))); }",
  "    catch (error) { resolve(\"blocked:\" + (error && error.name ? error.name : \"error\")); return; }",
  "    const timer = setTimeout(() => { worker.terminate(); resolve(\"timeout\"); }, 4000);",
  "    worker.onmessage = (event) => { clearTimeout(timer); worker.terminate(); resolve(event.data); };",
  "    worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); resolve(\"error:\" + (event.message || \"worker\")); };",
  "    worker.postMessage(\"probe\");",
  "  });",
  "}",
  "function probeWorkerTermination() {",
  "  return new Promise((resolve) => {",
  "    let worker;",
  "    try { worker = new Worker(URL.createObjectURL(new Blob([\"self.onmessage = () => { const until = Date.now() + 5000; while (Date.now() < until) {} self.postMessage(\\\"done\\\"); };\"], { type: \"text/javascript\" }))); }",
  "    catch (error) { resolve(\"blocked:\" + (error && error.name ? error.name : \"error\")); return; }",
  "    const started = Date.now();",
  "    worker.postMessage(\"go\");",
  "    setTimeout(() => { worker.terminate(); setTimeout(() => resolve({ terminated: true, mainThreadDelayMs: Date.now() - started }), 50); }, 150);",
  "  });",
  "}",
].join("\n");

const BUSY_BOOTSTRAP = "<!doctype html><script>addEventListener(\"message\", (event) => { if (event.data !== \"go\") return; const until = Date.now() + 1200; while (Date.now() < until) {} parent.postMessage({ type: \"busy-done\" }, \"*\"); }, { once: true });<\/script>";

function sandboxFrame(srcdoc) {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("csp", "default-src 'none'; script-src 'unsafe-inline'; worker-src blob:");
  frame.srcdoc = srcdoc;
  document.body.appendChild(frame);
  return frame;
}

function probe(rpcCalls) {
  return new Promise((resolve) => {
    const frame = sandboxFrame("<!doctype html><script>" + bootstrapScript + "<\/script>");
    const timer = setTimeout(() => resolve({ report: null, origin: null, domReadable: true }), 8000);
    addEventListener("message", function onMessage(event) {
      if (event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data) return;
      if (data.type === "tool") {
        rpcCalls.push({ method: data.method, args: data.args });
        frame.contentWindow.postMessage({ type: "tool-result", id: data.id, value: { value: data.args?.value } }, "*");
        return;
      }
      if (data.type !== "probe") return;
      clearTimeout(timer);
      removeEventListener("message", onMessage);
      resolve({ report: data.report, origin: event.origin, domReadable: frame.contentDocument !== null, frame });
    });
  });
}

function headerProbe() {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.src = "/runner.html";
    document.body.appendChild(frame);
    const timer = setTimeout(() => resolve({ report: null, origin: null }), 5000);
    addEventListener("message", function onMessage(event) {
      if (event.source !== frame.contentWindow) return;
      if (!event.data || event.data.type !== "header-probe") return;
      clearTimeout(timer);
      removeEventListener("message", onMessage);
      resolve({ report: event.data.report, origin: event.origin });
    });
  });
}

async function busyLoopProbe() {
  const frame = sandboxFrame(BUSY_BOOTSTRAP);
  await new Promise((resolve) => { frame.onload = resolve; });
  await sleep(50);
  let doneAt = 0;
  const done = new Promise((resolve) => {
    const onMessage = (event) => {
      if (event.source !== frame.contentWindow) return;
      if (!event.data || event.data.type !== "busy-done") return;
      removeEventListener("message", onMessage);
      doneAt = Date.now();
      resolve();
    };
    addEventListener("message", onMessage);
  });
  const started = Date.now();
  const timer = new Promise((resolve) => setTimeout(resolve, 100));
  frame.contentWindow.postMessage("go", "*");
  await timer;
  const timerDelay = Date.now() - started - 100;
  await done;
  const loopMs = doneAt - started;
  frame.remove();
  return { timerDelay, loopMs };
}

async function main() {
  const environment = {
    crossOriginIsolated: window.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer === "function",
    href: location.href,
  };

  const rpcCalls = [];
  const probeResult = await probe(rpcCalls);
  const report = probeResult.report;

  record("H7 page cross-origin isolated", environment.crossOriginIsolated === true, String(environment.crossOriginIsolated));
  record("H1 iframe origin is opaque (event.origin === null)", probeResult.origin === "null", String(probeResult.origin));
  record("H1 parent cannot read the sandbox DOM", probeResult.domReadable === false, String(probeResult.domReadable));
  record("H1 iframe cannot read parent DOM", report?.parentDom === "blocked", String(report?.parentDom));
  record("H1 localStorage blocked", report?.localStorage === "blocked", String(report?.localStorage));
  record("H1 IndexedDB blocked", report?.indexedDB === "blocked", String(report?.indexedDB));
  record("H1 OPFS blocked", report?.opfs === "blocked", String(report?.opfs));
  record("H2 CSP blocks fetch", report?.fetch === "blocked", String(report?.fetch));
  record("H3 tool RPC round trip", report?.rpc === "ok" && rpcCalls.length === 1, "rpc=" + String(report?.rpc) + " calls=" + rpcCalls.length);
  record("H5 opaque iframe can create a blob Worker", typeof report?.worker === "object" || (typeof report?.worker === "string" && report.worker.startsWith("error:")), JSON.stringify(report?.worker));
  record("H6 worker localStorage blocked", report?.worker?.localStorage === "blocked", String(report?.worker?.localStorage));
  record("H6 worker IndexedDB blocked", report?.worker?.indexedDB === "blocked", String(report?.worker?.indexedDB));
  record("H6 worker OPFS inaccessible", report?.worker?.opfs === "blocked" || report?.worker?.opfs === "absent", String(report?.worker?.opfs));
  record("H6 worker fetch blocked", report?.worker?.fetch === "blocked", String(report?.worker?.fetch));
  const termination = report?.workerTermination;
  record("H6 worker terminates during a busy loop", termination?.terminated === true, JSON.stringify(termination));
  record("H6 iframe main thread stays responsive with a busy worker", typeof termination?.mainThreadDelayMs === "number" && termination.mainThreadDelayMs < 800, JSON.stringify(termination?.mainThreadDelayMs));
  const header = await headerProbe();
  record("H1 header-served runner is opaque (event.origin === null)", header.origin === "null", String(header.origin));
  record("H1 header-served runner blocks localStorage", header.report?.localStorage === "blocked", String(header.report?.localStorage));
  record("H2 header CSP blocks fetch in the runner", header.report?.fetch === "blocked", String(header.report?.fetch));

  const busy = await busyLoopProbe();
  record("H4 the busy loop actually ran", busy.loopMs >= 900, "loop " + busy.loopMs + "ms");
  record(
    "H4 the sandbox iframe is process-isolated (parent not blocked)",
    busy.timerDelay < 300,
    "parent timer delayed by " + busy.timerDelay + "ms",
  );

  const passed = checks.filter((check) => check.ok).length;
  window.__PTC_SPIKE__ = { done: true, checks, environment, passed, total: checks.length };
  document.getElementById("out").textContent = JSON.stringify(window.__PTC_SPIKE__, null, 2);
  console.log("PTC spike finished: " + passed + "/" + checks.length);
}

main().catch((error) => {
  window.__PTC_SPIKE__ = { done: true, checks, environment: {}, error: String(error && error.stack ? error.stack : error) };
  console.error("PTC spike failed", error);
});
