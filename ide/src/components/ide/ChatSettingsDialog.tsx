// The BYO-key settings dialog (D-045). The key never leaves this browser except as
// the chosen provider's own auth header; switching provider clears the key field so
// one provider's secret can never be sent to another by accident.

import { useEffect, useState } from "react";
import { availableProviders, providerById, resolveBaseUrl } from "@/ai/providers";
import type { ChatSession } from "@/ai/chat-session";
import type { AiSettings } from "@/ai/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t, type MessageKey } from "@/i18n";

interface Props {
  chat: ChatSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: AiSettings | null;
}

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring";

export function ChatSettingsDialog({ chat, open, onOpenChange, current }: Props) {
  const [providerId, setProviderId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const providers = availableProviders();
  const preset = providerById(providerId);

  // Re-seed on every open: the dialog is a form over the saved settings, not a
  // live editor of them, so an abandoned edit must not leak into the next open.
  useEffect(() => {
    if (!open) return;
    const list = availableProviders();
    const saved = current ? providerById(current.providerId) : undefined;
    const first = saved ?? list[0];
    setProviderId(first?.id ?? "");
    setApiKey(current?.apiKey ?? "");
    setModel(current?.model || first?.defaultModel || "");
    setBaseUrl(current?.baseUrl ?? "");
    setError(null);
  }, [open, current]);

  const choose = (id: string) => {
    const next = providerById(id);
    setProviderId(id);
    setError(null);
    if (!next) return;
    // Provider-specific secrets: never carry a key across providers.
    setApiKey("");
    setModel(next.defaultModel);
    setBaseUrl("");
  };

  const save = () => {
    const next = providerById(providerId);
    if (!next) {
      setError("chat.settings.errorProvider");
      return;
    }
    const nextModel = model.trim();
    if (!nextModel) {
      setError("chat.settings.errorModel");
      return;
    }
    const settings: AiSettings = {
      providerId: next.id,
      apiKey: apiKey.trim(),
      model: nextModel,
      baseUrl: baseUrl.trim(),
    };
    if (next.requiresKey && settings.apiKey.length === 0) {
      setError("chat.settings.errorKey");
      return;
    }
    // The dev mock is the one provider with no endpoint (mirrors providers.isConfigured).
    if (next.id !== "mock" && resolveBaseUrl(settings, next).length === 0) {
      setError("chat.settings.errorBaseUrl");
      return;
    }
    chat.saveSettings(settings);
    onOpenChange(false);
  };

  const removeKey = () => {
    if (!current) return;
    const next = providerById(providerId);
    if (!next) return;
    chat.saveSettings({
      providerId: next.id,
      apiKey: "",
      model: model.trim() || current.model,
      baseUrl: baseUrl.trim(),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("chat.settings.title")}</DialogTitle>
          <DialogDescription>{t("chat.settings.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium" htmlFor="chat-provider">
            {t("chat.settings.provider")}
          </label>
          <select
            id="chat-provider"
            className={SELECT_CLASS}
            value={providerId}
            onChange={(event) => choose(event.target.value)}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {t(provider.labelKey)}
              </option>
            ))}
          </select>
          {preset && <p className="text-[11px] text-muted-foreground">{t(preset.keyHintKey)}</p>}

          <label className="mt-1 text-xs font-medium" htmlFor="chat-api-key">
            {t("chat.settings.apiKey")}
          </label>
          <Input
            id="chat-api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={t("chat.settings.apiKeyPlaceholder")}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />

          <label className="mt-1 text-xs font-medium" htmlFor="chat-model">
            {t("chat.settings.model")}
          </label>
          <Input
            id="chat-model"
            autoComplete="off"
            spellCheck={false}
            placeholder={preset?.defaultModel ?? ""}
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />

          <label className="mt-1 text-xs font-medium" htmlFor="chat-base-url">
            {t("chat.settings.baseUrl")}
          </label>
          <Input
            id="chat-base-url"
            autoComplete="off"
            spellCheck={false}
            placeholder={preset?.baseUrl || t("chat.settings.baseUrlPlaceholder")}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />

          {preset?.id === "mock" && (
            <p className="rounded border border-warning px-1.5 py-1 text-[11px] text-warning">
              {t("chat.settings.mockNote")}
            </p>
          )}
          {error && <p className="text-[11px] text-destructive">{t(error)}</p>}
        </div>

        <DialogFooter className="sm:justify-end">
          {current && current.apiKey.length > 0 && (
            <Button variant="ghost" size="sm" className="sm:mr-auto" onClick={removeKey}>
              {t("chat.settings.clear")}
            </Button>
          )}
          <Button size="sm" onClick={save}>
            {t("chat.settings.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
