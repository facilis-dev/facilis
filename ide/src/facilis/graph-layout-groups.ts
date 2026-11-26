// The per-node feature-group overrides (issue #194 follow-up): one small file per pinned node
// under .facilis/graph/groups, so two people moving different nodes to groups merge cleanly.
// The file is { "id": "<node id>", "group": "<feature>" }; an absent file means "automatic".
// Pure: the caller reads/writes the bytes through graph-layout-io.

import { isRecord } from "./graph-layout-file.ts";

export interface GraphGroupFileEntry {
  readonly id: string;
  readonly group: string;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readEntry(value: unknown): GraphGroupFileEntry | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) return null;
  if (typeof value.group !== "string") return null;
  const group = value.group.trim();
  return group.length === 0 ? null : { id: value.id, group };
}

/** Decode the groups directory; a corrupt file is skipped so one bad byte loses one override. */
export function readGroupOverrides(
  files: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const groups: Record<string, string> = {};
  for (const text of Object.values(files ?? {})) {
    const entry = readEntry(parseJson(text));
    if (entry !== null) groups[entry.id] = entry.group;
  }
  return groups;
}

/** One stable line per override, matching the positions/bends file style. */
export function groupText(id: string, group: string): string {
  return JSON.stringify({ id, group }) + "\n";
}
