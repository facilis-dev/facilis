// Analyzer worker: runs @facilis.dev/analyze over a project snapshot in its own thread.
//
// The wasm parser needs ~250 MiB of linear memory and a top-level-await module, so it must
// not run on (or be bundled into) the editor's main thread. Protocol and guards live in
// analyze-protocol.ts; the parser adapter lives in oxc-browser.ts. No UI code here.

import { analyzeProject } from "@facilis.dev/analyze";
import { isAnalyzeRequest, type AnalyzeWorkerMessage } from "./analyze-protocol";
import { createBrowserOxcParser } from "./oxc-browser";

// The IDE's app tsconfig uses the DOM lib, not the webworker one, so the dedicated worker
// scope is described just enough for this file (no lib.webworker reference: its globals
// collide with DOM's for the whole program).
interface AnalyzerWorkerScope {
  postMessage(message: AnalyzeWorkerMessage): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
}

const scope = self as unknown as AnalyzerWorkerScope;

function send(message: AnalyzeWorkerMessage): void {
  scope.postMessage(message);
}

// Constructed after the module graph (including the wasm binding's TLA) has evaluated.
const parser = createBrowserOxcParser();

// Chrome drops messages posted to a module worker before its evaluation settles, so the
// client waits for this instead of racing the analysis request (findings §4.2).
send({ type: "ready" });

scope.addEventListener("message", (event) => {
  const request = event.data;
  if (!isAnalyzeRequest(request)) {
    send({ type: "error", message: "invalid analyzer request" });
    return;
  }
  try {
    const files = new Map<string, string>(request.files.map(([path, source]) => [path, source]));
    send({ type: "result", analysis: analyzeProject({ files, parser }) });
  } catch (error) {
    send({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
});
