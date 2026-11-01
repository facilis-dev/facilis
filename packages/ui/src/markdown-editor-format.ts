/**
 * Pure textarea transforms for the MarkdownEditor toolbar. Each helper takes and returns the
 * value plus selection so the component only has to apply the result and restore the caret.
 */

export type TextSelection = {
  value: string;
  start: number;
  end: number;
};

/** Wraps the selection (or inserts an empty pair at the caret) with the given markers. */
export function wrapSelection(state: TextSelection, before: string, after = before): TextSelection {
  const selected = state.value.slice(state.start, state.end);
  const value =
    state.value.slice(0, state.start) + before + selected + after + state.value.slice(state.end);
  return {
    value,
    start: state.start + before.length,
    end: state.start + before.length + selected.length,
  };
}

/** Inserts a Markdown link around the selection and leaves the URL placeholder selected. */
export function insertLink(state: TextSelection): TextSelection {
  const wrapped = wrapSelection(state, "[", "](https://)");
  const urlStart = wrapped.start + (state.end - state.start) + 2;
  return { ...wrapped, start: urlStart, end: urlStart + "https://".length };
}

function linesOf(state: TextSelection): { from: number; to: number; lines: string[] } {
  const from = state.value.lastIndexOf("\n", state.start - 1) + 1;
  const searchFrom = Math.max(state.start, state.end - 1);
  const newline = state.value.indexOf("\n", searchFrom);
  const to = newline === -1 ? state.value.length : newline;
  return { from, to, lines: state.value.slice(from, to).split("\n") };
}

/** Adds or removes the prefix on every line touched by the selection (all-or-nothing toggle). */
export function toggleLinePrefix(state: TextSelection, prefix: string): TextSelection {
  const { from, to, lines } = linesOf(state);
  const nonEmpty = lines.filter((line) => line !== "");
  const prefixed = nonEmpty.length > 0 && nonEmpty.every((line) => line.startsWith(prefix));
  const nextLines = lines.map((line) => {
    if (line === "") return line;
    return prefixed ? line.slice(prefix.length) : prefix + line;
  });
  const value = state.value.slice(0, from) + nextLines.join("\n") + state.value.slice(to);
  return { value, start: from, end: to + (value.length - state.value.length) };
}

/** Numbers the selected lines, or strips existing numbering when every line is already numbered. */
export function toggleOrderedList(state: TextSelection): TextSelection {
  const { from, to, lines } = linesOf(state);
  const nonEmpty = lines.filter((line) => line !== "");
  const numbered = /^\s*\d+[.)]\s+/;
  const allNumbered = nonEmpty.length > 0 && nonEmpty.every((line) => numbered.test(line));
  let counter = 1;
  const nextLines = lines.map((line) => {
    if (line === "") return line;
    if (allNumbered) return line.replace(numbered, "");
    const number = counter;
    counter += 1;
    return number + ". " + line;
  });
  const value = state.value.slice(0, from) + nextLines.join("\n") + state.value.slice(to);
  return { value, start: from, end: to + (value.length - state.value.length) };
}
