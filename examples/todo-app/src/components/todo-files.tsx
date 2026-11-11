import { useRef } from "react";
import { t } from "@facilis.dev/core/i18n";
import { IconAttach, IconRemove } from "./icons.tsx";
import { Button } from "./ui/button.tsx";

/** One attachment as the API lists it (D-053): url is null when storage did not boot. */
export interface TodoFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string | null;
}

export type TodoFilesProps = {
  files: readonly TodoFile[];
  canWrite: boolean;
  busy: boolean;
  onUpload: (file: File) => void;
  onRemove: (file: TodoFile) => void;
};

/**
 * Attachments under a todo title: each name links to its signed download URL, and a writer
 * gets one hidden file input plus an Attach button to add another. Kept presentational: the
 * page owns the API calls, toasts and list reload.
 */
export function TodoFiles({ files, canWrite, busy, onUpload, onRemove }: TodoFilesProps) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="mt-1 flex flex-col items-start gap-1">
      {files.length === 0 ? null : (
        <ul
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
          aria-label={t("todos.files.label")}
        >
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-1">
              {file.url === null ? (
                <span className="text-muted-foreground">{file.name}</span>
              ) : (
                <a
                  className="underline decoration-dotted underline-offset-2 hover:text-primary"
                  href={file.url}
                  download={file.name}
                  title={t("todos.files.download")}
                >
                  {file.name}
                </a>
              )}
              {canWrite ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-5 text-muted-foreground"
                  aria-label={t("todos.files.remove")}
                  disabled={busy}
                  onClick={() => onRemove(file)}
                >
                  <IconRemove className="size-3" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <>
          <input
            ref={input}
            type="file"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Clear the value first: picking the same file again must still fire onChange.
              event.target.value = "";
              if (file !== undefined) onUpload(file);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <IconAttach className="size-3" />
            {t("todos.files.attach")}
          </Button>
        </>
      ) : null}
    </div>
  );
}
