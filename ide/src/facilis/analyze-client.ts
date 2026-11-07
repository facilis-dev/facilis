// Browser-side project analysis for the IDE (task-6, task-10).
//
// Reads the active project's DSL surface out of the VFS, hands it to one module worker that
// runs @facilis/analyze with oxc-parser's wasm binding, and returns the fact model. The
// contract is throw-free (project-analysis.ts): every failure is an { ok:false, error } the
// panel renders, so nothing here can take React down.
//
// Two callers share the same snapshot read: the project-graph panel analyzes the project as
// it is, the AI patch validator analyzes it before and after a proposed patch set. The read
// is cached per controller snapshot (the file-list array reference), so a chat proposal does
// not re-read hundreds of files the graph panel just read.
//
// One worker per tab is intentional: the wasm instance reserves ~250 MiB of linear memory,
// and analyses are serialized so a late result can never land on a newer snapshot.

import type { IdeController } from "@/vv/controller";
import { analysisSizeError, selectAnalysisFiles } from "./analyze-files";
import {
  isErrorMessage,
  isReadyMessage,
  isResultMessage,
  toAnalyzeRequest,
  type AnalyzeRequest,
} from "./analyze-protocol";
import type { ProjectAnalysisResult } from "./project-analysis";

/** The wasm module is ~1.5 MB; a cold load on a slow link is the slowest healthy path. */
const READY_TIMEOUT_MS = 30_000;
/** The probe parsed 813 files in ~330 ms; this only catches a hung worker. */
const ANALYSIS_TIMEOUT_MS = 30_000;

let worker: Worker | null = null;
let ready: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

export type ProjectSourceResult =
  | { readonly ok: true; readonly files: ReadonlyMap<string, string> }
  | { readonly ok: false; readonly error: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function absolutePath(root: string, relative: string): string {
  return root === "/" ? "/" + relative : root + "/" + relative;
}

/** Spawn the worker and resolve once it reports its wasm module is evaluable. */
function spawnWorker(): Promise<Worker> {
  const instance = new Worker(new URL("./analyze-worker.ts", import.meta.url), {
    type: "module",
    name: "facilis-analyze",
  });
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      instance.removeEventListener("message", onMessage);
      instance.removeEventListener("error", onError);
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (!isReadyMessage(event.data)) return;
      cleanup();
      resolve(instance);
    };
    const onError = (event: ErrorEvent): void => {
      cleanup();
      instance.terminate();
      reject(new Error(event.message.length > 0 ? event.message : "analyzer worker failed"));
    };
    instance.addEventListener("message", onMessage);
    instance.addEventListener("error", onError);
    timer = setTimeout(() => {
      cleanup();
      instance.terminate();
      reject(new Error("analyzer worker did not become ready within 30s"));
    }, READY_TIMEOUT_MS);
  });
}

async function ensureWorker(): Promise<Worker> {
  if (worker !== null) return worker;
  if (ready === null) {
    ready = spawnWorker().then(
      (instance) => {
        worker = instance;
        return instance;
      },
      (error: unknown) => {
        ready = null;
        throw error;
      },
    );
  }
  return ready;
}

function terminateWorker(): void {
  worker?.terminate();
  worker = null;
  ready = null;
}

/** Send one request and wait for its result/error message, or the timeout. */
function requestAnalysis(
  target: Worker,
  files: ReadonlyMap<string, string>,
): Promise<ProjectAnalysisResult> {
  const request: AnalyzeRequest = toAnalyzeRequest(files);
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      target.removeEventListener("message", onMessage);
      target.removeEventListener("error", onError);
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      const message = event.data;
      if (isResultMessage(message)) {
        cleanup();
        resolve({ ok: true, analysis: message.analysis });
        return;
      }
      if (isErrorMessage(message)) {
        cleanup();
        reject(new Error(message.message));
      }
    };
    const onError = (event: ErrorEvent): void => {
      cleanup();
      reject(new Error(event.message.length > 0 ? event.message : "analyzer worker failed"));
    };
    target.addEventListener("message", onMessage);
    target.addEventListener("error", onError);
    target.postMessage(request);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error("analysis timed out after 30s"));
    }, ANALYSIS_TIMEOUT_MS);
  });
}

interface SourceCacheEntry {
  /** The controller snapshot's file list: a new array means a changed project. */
  readonly snapshotFiles: readonly string[];
  readonly root: string;
  readonly result: Promise<ProjectSourceResult>;
}

let sourceCache: SourceCacheEntry | null = null;

function activeRoot(controller: IdeController): string | null {
  const snapshot = controller.getSnapshot();
  return (
    snapshot.workspaceFolders.find((folder) => folder.id === snapshot.activeFolderId)?.rootPath ??
    null
  );
}

async function readSelectedSources(
  controller: IdeController,
  snapshotFiles: readonly string[],
  root: string,
): Promise<ProjectSourceResult> {
  const selection = selectAnalysisFiles(snapshotFiles, root);
  if (!selection.ok) return selection;
  const files = new Map<string, string>();
  let totalChars = 0;
  for (const path of selection.paths) {
    const source = await controller.readFileText(absolutePath(root, path));
    totalChars += source.length;
    const sizeError = analysisSizeError(totalChars);
    if (sizeError !== null) return { ok: false, error: sizeError };
    files.set(path, source);
  }
  return { ok: true, files };
}

/**
 * The analyzer's file map for the active project, cached per controller snapshot. Shared by
 * the graph panel and the patch validator; a snapshot change (files array identity) drops it.
 */
export function loadProjectSources(controller: IdeController): Promise<ProjectSourceResult> {
  const snapshot = controller.getSnapshot();
  const root = activeRoot(controller);
  if (root === null) return Promise.resolve({ ok: false, error: "no active project to analyze" });
  const cached = sourceCache;
  if (cached !== null && cached.snapshotFiles === snapshot.files && cached.root === root) {
    return cached.result;
  }
  const entry: SourceCacheEntry = {
    snapshotFiles: snapshot.files,
    root,
    result: readSelectedSources(controller, snapshot.files, root),
  };
  sourceCache = entry;
  // A read can fail transiently (bridge restart). Do not pin the failure; the next ask
  // retries against the same snapshot. Deterministic failures (size caps) stay cached.
  entry.result.catch(() => {
    if (sourceCache === entry) sourceCache = null;
  });
  return entry.result;
}

/** Analyze one file map on the shared worker. Requests are serialized one at a time. */
export function analyzeProjectFiles(
  files: ReadonlyMap<string, string>,
): Promise<ProjectAnalysisResult> {
  const run = queue.then(() => analyzeFiles(files));
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function analyzeFiles(files: ReadonlyMap<string, string>): Promise<ProjectAnalysisResult> {
  try {
    const target = await ensureWorker();
    return await requestAnalysis(target, files);
  } catch (error) {
    terminateWorker();
    return { ok: false, error: messageOf(error) };
  }
}

/** Analyze the active project from its cached VFS snapshot. */
export async function loadProjectAnalysis(
  controller: IdeController,
): Promise<ProjectAnalysisResult> {
  try {
    const sources = await loadProjectSources(controller);
    if (!sources.ok) return sources;
    return await analyzeProjectFiles(sources.files);
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}
