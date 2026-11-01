import { useEffect, useId, useRef, useState, type AriaAttributes, type KeyboardEvent } from "react";
import { cx } from "./class-names.ts";
import { Markdown } from "./markdown.tsx";
import {
  insertLink,
  toggleLinePrefix,
  toggleOrderedList,
  wrapSelection,
  type TextSelection,
} from "./markdown-editor-format.ts";
import { nextTabIndex } from "./tab-keys.ts";
import "./markdown-editor.css";

export type MarkdownEditorLabels = {
  bold: string;
  italic: string;
  heading: string;
  bulletedList: string;
  numberedList: string;
  quote: string;
  code: string;
  link: string;
  write: string;
  preview: string;
};

export type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  labels?: MarkdownEditorLabels;
  className?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
};

const DEFAULT_LABELS = {
  bold: "Bold",
  italic: "Italic",
  heading: "Heading",
  bulletedList: "Bulleted list",
  numberedList: "Numbered list",
  quote: "Quote",
  code: "Code",
  link: "Link",
  write: "Write",
  preview: "Preview",
} as const;

// The inline-code marker is a backtick, kept as a constant so this file needs no escaping.
const CODE_MARKER = String.fromCharCode(96);

type Mode = "write" | "preview";

type Caret = { start: number; end: number };

type Tool = {
  label: string;
  glyph: string;
  transform: (selection: TextSelection) => TextSelection;
};

/**
 * Markdown editor: a toolbar that edits the textarea selection, Ctrl/Cmd+B/I/K shortcuts and a
 * write/preview switch. The preview is the safe Markdown renderer, never raw HTML.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write Markdown…",
  rows = 8,
  disabled = false,
  labels,
  className,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: MarkdownEditorProps) {
  const resolved = { ...DEFAULT_LABELS, ...labels };
  const baseId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("write");
  const [caret, setCaret] = useState<Caret | null>(null);

  useEffect(() => {
    if (caret === null) return;
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.focus();
    textarea.setSelectionRange(caret.start, caret.end);
    setCaret(null);
  }, [caret]);

  function run(transform: (selection: TextSelection) => TextSelection): void {
    const textarea = textareaRef.current;
    const selection: TextSelection =
      textarea === null
        ? { value, start: value.length, end: value.length }
        : { value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd };
    const edit = transform(selection);
    onChange(edit.value);
    setCaret({ start: edit.start, end: edit.end });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      run((selection) => wrapSelection(selection, "**"));
    } else if (key === "i") {
      event.preventDefault();
      run((selection) => wrapSelection(selection, "_"));
    } else if (key === "k") {
      event.preventDefault();
      run(insertLink);
    }
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const next = nextTabIndex(event.key, index, tabs.length);
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next];
    if (target === undefined) return;
    setMode(target.id);
    tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  const tools: Tool[] = [
    { label: resolved.bold, glyph: "B", transform: (selection) => wrapSelection(selection, "**") },
    { label: resolved.italic, glyph: "I", transform: (selection) => wrapSelection(selection, "_") },
    {
      label: resolved.heading,
      glyph: "H2",
      transform: (selection) => toggleLinePrefix(selection, "## "),
    },
    {
      label: resolved.bulletedList,
      glyph: "•",
      transform: (selection) => toggleLinePrefix(selection, "- "),
    },
    { label: resolved.numberedList, glyph: "1.", transform: toggleOrderedList },
    {
      label: resolved.quote,
      glyph: "❝",
      transform: (selection) => toggleLinePrefix(selection, "> "),
    },
    {
      label: resolved.code,
      glyph: "</>",
      transform: (selection) => wrapSelection(selection, CODE_MARKER),
    },
    { label: resolved.link, glyph: "↗", transform: insertLink },
  ];

  const tabs: Array<{ id: Mode; label: string }> = [
    { id: "write", label: resolved.write },
    { id: "preview", label: resolved.preview },
  ];

  return (
    <div
      className={cx("fc-markdown-editor", disabled && "fc-markdown-editor--disabled", className)}
    >
      <div className="fc-markdown-editor__toolbar">
        {tools.map((tool) => (
          <button
            key={tool.label}
            type="button"
            className="fc-markdown-editor__tool"
            aria-label={tool.label}
            title={tool.label}
            disabled={disabled}
            onClick={() => run(tool.transform)}
          >
            <span aria-hidden="true">{tool.glyph}</span>
          </button>
        ))}
        <div
          ref={tabListRef}
          className="fc-markdown-editor__tabs"
          role="tablist"
          aria-label={resolved.write + " / " + resolved.preview}
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={baseId + tab.id + "-tab"}
              className="fc-markdown-editor__tab"
              aria-selected={mode === tab.id}
              aria-controls={baseId + tab.id + "-panel"}
              tabIndex={mode === tab.id ? 0 : -1}
              onClick={() => setMode(tab.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {mode === "write" ? (
        <div role="tabpanel" id={baseId + "write-panel"} aria-labelledby={baseId + "write-tab"}>
          <textarea
            ref={textareaRef}
            id={id}
            className="fc-markdown-editor__textarea"
            rows={rows}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
      ) : (
        <div
          className="fc-markdown-editor__preview"
          role="tabpanel"
          id={baseId + "preview-panel"}
          aria-labelledby={baseId + "preview-tab"}
        >
          <Markdown source={value} />
        </div>
      )}
    </div>
  );
}
