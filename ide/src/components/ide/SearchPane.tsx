import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Loader from "~icons/lucide/loader-circle";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useIde } from "./useIde";
import { SearchForm } from "./SearchForm";
import { SearchResults } from "./SearchResults";
import type { SearchDone, SearchFileResult } from "@/vv/controller";

export function SearchPane() {
  const { c, snap } = useIde();

  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [preserveCase, setPreserveCase] = useState(false);
  const [includeGlob, setIncludeGlob] = useState("");
  const [excludeGlob, setExcludeGlob] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const [results, setResults] = useState<SearchFileResult[]>([]);
  const [summary, setSummary] = useState<SearchDone | null>(null);
  const [searching, setSearching] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const cancelRef = useRef<(() => void) | null>(null);

  // Validate the regex client-side so a bad pattern shows an error instead of
  // firing a doomed search.
  const regexError = useMemo(() => {
    if (!regex || !query) return null;
    try {
      // eslint-disable-next-line no-new
      new RegExp(query);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid regular expression";
    }
  }, [regex, query]);

  const hasRoots = snap.workspaceFolders.length > 0;

  // Debounced search: re-run whenever the query or any option changes.
  useEffect(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    const q = query;
    if (!q || regexError || !hasRoots) {
      setResults([]);
      setSummary(null);
      setSearching(false);
      return;
    }
    const t = setTimeout(() => {
      setResults([]);
      setSummary(null);
      setSearching(true);
      cancelRef.current = c.runSearch(
        { query: q, matchCase, wholeWord, regex, includeGlob, excludeGlob },
        {
          onBatch: (files) => setResults((prev) => prev.concat(files)),
          onDone: (d) => {
            setSummary(d);
            setSearching(false);
          },
        },
      );
    }, 250);
    return () => clearTimeout(t);
    // treeVersion re-runs the search after a replace/file change refreshes the VFS.
  }, [
    c,
    query,
    matchCase,
    wholeWord,
    regex,
    includeGlob,
    excludeGlob,
    hasRoots,
    regexError,
    snap.treeVersion,
  ]);

  // Cancel any in-flight search when the pane unmounts.
  useEffect(() => () => cancelRef.current?.(), []);

  const replaceOpts = useMemo(
    () => ({ query, matchCase, wholeWord, regex, replacement: replaceText, preserveCase }),
    [query, matchCase, wholeWord, regex, replaceText, preserveCase],
  );
  const totalMatches = summary?.matchCount ?? results.reduce((n, f) => n + f.matches.length, 0);

  const doReplaceAll = useCallback(async () => {
    const files = results.map((f) => f.file);
    if (!files.length) return;
    await c.replace({ ...replaceOpts, files });
    // The vv-fs-changed bump re-runs the search via treeVersion.
  }, [c, results, replaceOpts]);

  const doReplaceFile = useCallback(
    async (file: string) => {
      await c.replace({ ...replaceOpts, files: [file] });
    },
    [c, replaceOpts],
  );

  const doReplaceMatch = useCallback(
    async (file: string, m: SearchFileResult["matches"][number]) => {
      await c.replace({
        ...replaceOpts,
        match: { file, line: m.line, column: m.column, length: m.length },
      });
    },
    [c, replaceOpts],
  );

  const toggleCollapsed = (file: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });

  const dismissFile = (file: string) => setResults((prev) => prev.filter((f) => f.file !== file));

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-8 shrink-0 items-center px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Search
      </div>

      <SearchForm
        query={query}
        onQueryChange={setQuery}
        matchCase={matchCase}
        wholeWord={wholeWord}
        regex={regex}
        regexError={regexError}
        onToggleMatchCase={() => setMatchCase((v) => !v)}
        onToggleWholeWord={() => setWholeWord((v) => !v)}
        onToggleRegex={() => setRegex((v) => !v)}
        showReplace={showReplace}
        onToggleReplace={() => setShowReplace((v) => !v)}
        replaceText={replaceText}
        onReplaceTextChange={setReplaceText}
        preserveCase={preserveCase}
        onTogglePreserveCase={() => setPreserveCase((v) => !v)}
        onReplaceAll={doReplaceAll}
        canReplaceAll={totalMatches > 0}
        showDetails={showDetails}
        onToggleDetails={() => setShowDetails((v) => !v)}
        includeGlob={includeGlob}
        onIncludeGlobChange={setIncludeGlob}
        excludeGlob={excludeGlob}
        onExcludeGlobChange={setExcludeGlob}
      />

      {/* summary */}
      {query && !regexError && hasRoots && (
        <div className="flex items-center gap-1.5 px-3 pb-1 text-[11px] text-muted-foreground">
          {searching && <Loader className="size-3 animate-spin" />}
          {results.length > 0
            ? `${totalMatches} result${totalMatches === 1 ? "" : "s"} in ${results.length} file${results.length === 1 ? "" : "s"}`
            : searching
              ? "Searching…"
              : summary?.error
                ? summary.error
                : "No results found."}
          {summary?.limitHit && <span className="text-warning">· results limited</span>}
        </div>
      )}

      {/* results */}
      <ScrollArea className="flex-1">
        <div className="pb-4">
          {!hasRoots ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Open a project to search.</div>
          ) : !query ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Search across all files in the workspace.
            </div>
          ) : (
            <SearchResults
              results={results}
              collapsed={collapsed}
              showReplace={showReplace}
              onToggle={toggleCollapsed}
              onOpenMatch={(file, m) => c.openFileAt(file, m.line, m.column, m.length)}
              onReplaceFile={(file) => void doReplaceFile(file)}
              onReplaceMatch={(file, m) => void doReplaceMatch(file, m)}
              onDismiss={dismissFile}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
