import Lock from "~icons/lucide/lock";
import { t as translate } from "@/i18n";

// The preview address bar (issue #224). Navigation is local-only: localhost / 127.0.0.1 /
// a bare path loads the in-VM dev server; external URLs are rejected (see navigatePreview).
// The ring rides on the shell so it follows the whole field, lock mark included, since the
// input itself suppresses the native outline.
export function PreviewAddressBar({
  url,
  onUrlChange,
  onNavigate,
}: {
  url: string;
  onUrlChange: (url: string) => void;
  onNavigate: (url: string) => void;
}) {
  return (
    <div className="mx-1 flex flex-1 items-center gap-1.5 rounded bg-background px-2 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      <Lock className="size-3 shrink-0 text-muted-foreground" />
      <input
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onNavigate((e.target as HTMLInputElement).value);
        }}
        placeholder="localhost:3000"
        aria-label={translate("preview.address")}
        spellCheck={false}
        className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground ring-0"
      />
    </div>
  );
}
