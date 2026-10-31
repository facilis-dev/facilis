// Full-text search / replace across every workspace root. The kernel worker
// does the scanning and streams per-file batches back; this session owns the
// in-flight state and the wire protocol. Split out of controller.ts (D-019),
// which supplies the roots and re-syncs affected editor buffers afterwards.

import { toast } from "sonner";
import type { KernelBridge, KernelMessage } from "./kernel";

export interface SearchOptions {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  includeGlob: string;
  excludeGlob: string;
}
export interface SearchMatch {
  line: number; // 1-based
  column: number; // 1-based
  length: number;
  preview: string; // the full (capped) source line, for highlighting
}
export interface SearchFileResult {
  file: string; // absolute path
  root: string; // the workspace root it was found under
  matches: SearchMatch[];
}
export interface SearchDone {
  matchCount: number;
  fileCount: number;
  limitHit: boolean;
  error?: string;
}

/** What the session needs from the controller. */
export interface SearchHost {
  /** Every open workspace root, searched in turn. */
  roots(): string[];
  /** Re-read a file a replace rewrote on disk into its open model + cache. */
  refreshFileFromDisk(abs: string): Promise<void>;
}

export interface ReplaceParams {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  replacement: string;
  preserveCase: boolean;
  files?: string[];
  match?: { file: string; line: number; column: number; length: number };
}

export interface ReplaceResult {
  ok: boolean;
  filesChanged: number;
  replaced: number;
  error?: string;
}

/** One in-flight search. A newer run() supersedes an older one by token. */
interface Pending {
  token: number;
  onBatch: (files: SearchFileResult[]) => void;
  onDone: (d: SearchDone) => void;
}

export class SearchSession {
  private readonly bridge: KernelBridge;
  private readonly host: SearchHost;
  private seq = 0;
  private pending: Pending | null = null;

  constructor(bridge: KernelBridge, host: SearchHost) {
    this.bridge = bridge;
    this.host = host;
  }

  // Stream a search across every open root. Results arrive via `onBatch`
  // (partial, progressive) then a final `onDone`. Returns a cancel fn.
  run(
    opts: SearchOptions,
    cb: { onBatch: (files: SearchFileResult[]) => void; onDone: (d: SearchDone) => void },
  ): () => void {
    const token = ++this.seq;
    this.pending = { token, onBatch: cb.onBatch, onDone: cb.onDone };
    this.bridge.post("vv-search", {
      token,
      roots: this.host.roots(),
      query: opts.query,
      matchCase: opts.matchCase,
      wholeWord: opts.wholeWord,
      regex: opts.regex,
      includeGlob: opts.includeGlob,
      // .facilis is IDE-managed dev state (D-052), not source: always excluded, without
      // rewriting what the user typed in the exclude field.
      excludeGlob: opts.excludeGlob ? opts.excludeGlob + ",.facilis" : ".facilis",
    });
    return () => {
      if (this.pending?.token === token) this.pending = null;
      this.bridge.post("vv-search-cancel", {});
    };
  }

  // Apply a replacement. Scope is either a single `match`, or an explicit list
  // of `files` (Replace All / per-file). Refreshes any affected open editor
  // models from disk so the buffer + dirty state stay in sync.
  async replace(params: ReplaceParams): Promise<ReplaceResult> {
    const res = await this.bridge.request("vv-replace", {
      query: params.query,
      matchCase: params.matchCase,
      wholeWord: params.wholeWord,
      regex: params.regex,
      replacement: params.replacement,
      preserveCase: params.preserveCase,
      files: params.files,
      match: params.match,
    });
    if (res.ok) {
      const affected = params.match ? [params.match.file] : (params.files ?? []);
      for (const abs of affected) await this.host.refreshFileFromDisk(abs);
    } else {
      toast.error(`Replace failed: ${res.error ?? "unknown error"}`);
    }
    return {
      ok: !!res.ok,
      filesChanged: Number(res.filesChanged ?? 0),
      replaced: Number(res.replaced ?? 0),
      error: res.error as string | undefined,
    };
  }

  // Streaming result batches: ignore tokens a newer query already superseded.
  onResult(m: KernelMessage) {
    if (this.pending && m.token === this.pending.token) {
      this.pending.onBatch((m.files as SearchFileResult[]) ?? []);
    }
  }

  onDone(m: KernelMessage) {
    if (!this.pending || m.token !== this.pending.token) return;
    const cbs = this.pending;
    this.pending = null;
    cbs.onDone({
      matchCount: Number(m.matchCount ?? 0),
      fileCount: Number(m.fileCount ?? 0),
      limitHit: !!m.limitHit,
      error: m.error as string | undefined,
    });
  }
}
