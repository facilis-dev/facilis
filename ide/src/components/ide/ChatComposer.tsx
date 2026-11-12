// The chat composer: draft, pasted screenshots (D-113) and send/stop.
//
// Extracted from ChatPanel, which sits at the 300-line limit. The composer owns its local
// state — the draft, the pending images and the paste notice — and a new chat remounts it, so
// nothing stale carries over into the next conversation. Sending while a turn runs queues the
// message (ChatQueueView); it is never dropped.

import { useState, type ClipboardEvent } from "react";
import X from "~icons/lucide/x";
import SendHorizontal from "~icons/lucide/send-horizontal";
import Square from "~icons/lucide/square";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MAX_IMAGES, isImageFile, readImages } from "@/ai/chat-image";
import { compressImage } from "@/ai/chat-image-resize";
import type { ChatSession } from "@/ai/chat-session";
import { providerById } from "@/ai/providers";
import type { ChatState } from "@/ai/types";
import { t } from "@/i18n";

export function ChatComposer({ chat, state }: { chat: ChatSession; state: ChatState }) {
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = state.phase !== "idle";
  const preset = state.settings ? providerById(state.settings.providerId) : undefined;

  const addImages = async (files: readonly File[]): Promise<void> => {
    const read = await readImages(files, compressImage);
    // The updater stays pure: React may run it twice in development.
    const room = Math.max(0, MAX_IMAGES - images.length);
    const dropped = read.skipped + Math.max(0, read.images.length - room);
    setImages((current) => [
      ...current,
      ...read.images.slice(0, Math.max(0, MAX_IMAGES - current.length)),
    ]);
    setNotice(dropped > 0 ? t("chat.image.skipped", { n: dropped }) : null);
  };

  /** Ctrl+V: the clipboard's image files become pending attachments, not text. */
  const paste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const files = Array.from(event.clipboardData.files);
    if (!files.some(isImageFile)) return;
    event.preventDefault();
    void addImages(files);
  };

  const submit = (): void => {
    const text = draft.trim();
    if (text.length === 0 && images.length === 0) return;
    const attached = images;
    setDraft("");
    setImages([]);
    setNotice(null);
    void chat.send(text, attached);
  };

  return (
    <div className="border-t p-2" onPaste={paste}>
      {images.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {images.map((src, index) => (
            <div key={index} className="relative">
              <img
                src={src}
                alt={t("chat.image.pending", { n: index + 1 })}
                className="max-h-20 rounded border border-border/60"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute -top-1.5 -right-1.5 size-5 rounded-full border border-border bg-background"
                aria-label={t("chat.image.remove")}
                title={t("chat.image.remove")}
                onClick={() => setImages((current) => current.filter((_, at) => at !== index))}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      )}
      {images.length > 0 && preset !== undefined && preset.vision !== true && (
        <p className="mb-1 text-[10px] text-destructive">{t("chat.image.noVision")}</p>
      )}
      {notice !== null && <p className="mb-1 text-[10px] text-muted-foreground">{notice}</p>}
      <Textarea
        rows={3}
        className="max-h-40 min-h-16 resize-none text-xs"
        placeholder={t("chat.placeholder")}
        aria-label={t("chat.placeholder")}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          submit();
        }}
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          {t("chat.footer")}
        </p>
        <div className="flex shrink-0 items-center">
          {busy && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("chat.stop")}
              title={t("chat.stop")}
              onClick={() => chat.cancel()}
            >
              <Square />
            </Button>
          )}
          <Button
            size="icon-sm"
            aria-label={t("chat.send")}
            title={busy ? t("chat.queue.add") : t("chat.send")}
            disabled={draft.trim().length === 0 && images.length === 0}
            onClick={submit}
          >
            <SendHorizontal />
          </Button>
        </div>
      </div>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
        {state.context
          ? t("chat.context", {
              manifest: state.context.manifestRevision
                ? t("chat.context.manifest", { revision: state.context.manifestRevision })
                : t("chat.context.noManifest"),
              files: state.context.files,
            }) + (state.context.instructions ? " · " + t("chat.context.agents") : "")
          : preset
            ? t("chat.configured", {
                provider: t(preset.labelKey),
                model: state.settings?.model ?? "",
              })
            : ""}
      </p>
    </div>
  );
}
