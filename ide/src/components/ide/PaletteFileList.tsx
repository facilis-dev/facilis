// The file half of the command palette: quick-open with an optional ":line[:col]" suffix.
// Split out of CommandPalette.tsx (issue #223) because that file sits at the 300-line cap.
import { useMemo } from "react";
import FileCode from "~icons/lucide/file-code";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { t } from "@/i18n";

const baseName = (abs: string) => abs.split("/").pop() ?? abs;

/** The path part of the query plus the optional line/column suffix (VS Code's "app.tsx:42"). */
function parseQuery(raw: string): { path: string; line: number | null; col: number } {
  const match = raw.match(/^(.*?):(\d+)(?::(\d+))?$/);
  if (match)
    return {
      path: match[1],
      line: parseInt(match[2], 10),
      col: match[3] ? parseInt(match[3], 10) : 1,
    };
  return { path: raw, line: null, col: 1 };
}

export function PaletteFileList({
  raw,
  files,
  activeTab,
  onOpen,
}: {
  raw: string;
  files: readonly string[];
  activeTab: string | null;
  onOpen: (rel: string, line: number | null, col: number) => void;
}) {
  const { path, line, col } = parseQuery(raw);
  // Filter here rather than in cmdk, so the ":line" suffix does not break matching.
  const matches = useMemo(() => {
    const needle = path.trim().toLowerCase();
    const list = needle ? files.filter((rel) => rel.toLowerCase().includes(needle)) : files;
    return list.slice(0, 200);
  }, [files, path]);
  return (
    <>
      {line != null && path.trim() === "" && activeTab !== null && (
        <CommandGroup heading={t("palette.currentFile")}>
          <CommandItem value="__goto_line__" onSelect={() => onOpen(activeTab, line, col)}>
            <FileCode /> <span>{t("palette.goToLine", { line })}</span>
            <span className="ml-auto text-xs text-muted-foreground">{baseName(activeTab)}</span>
          </CommandItem>
        </CommandGroup>
      )}
      <CommandGroup heading={line != null ? t("palette.filesLine", { line }) : t("palette.files")}>
        {matches.map((rel) => (
          <CommandItem key={rel} value={rel} onSelect={() => onOpen(rel, line, col)}>
            <FileCode /> <span>{baseName(rel)}</span>
            <span className="ml-auto text-xs text-muted-foreground">{rel}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  );
}
