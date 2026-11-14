/// <reference types="vite/client" />
/// <reference types="unplugin-icons/types/react" />

interface ImportMetaEnv {
  /**
   * Mode B (separate preview origin). When set to another origin (e.g.
   * `https://preview.facilis.dev`), previews are served from there for
   * IDE↔preview isolation. Unset in the default same-origin deploy + local dev.
   */
  readonly VITE_PREVIEW_ORIGIN?: string;
  /**
   * How "Open in new tab" behaves in mode B (see BootOptions.previewPopout).
   * `"same-origin"` (default) opens the pop-out on the IDE origin (frictionless,
   * not isolated); `"isolated"` opens it on the preview origin behind a one-time
   * Storage Access gate. Unset/ignored in the default same-origin deploy.
   */
  readonly VITE_PREVIEW_POPOUT?: "same-origin" | "isolated";
  /**
   * Mode C (wildcard per-port preview origins). Set to a **base domain** you
   * control (e.g. `"facilis.dev"`); each in-VM port is served from its own
   * origin `<token>--<port>.<domain>` for full IDE↔preview and preview↔preview
   * isolation with real `localhost:<port>` semantics. Takes precedence over
   * VITE_PREVIEW_ORIGIN. Requires the wildcard Worker + DNS (see docs/deployment).
   * Unset in the default deploy + local dev.
   */
  readonly VITE_PREVIEW_WILDCARD_DOMAIN?: string;
  /**
   * Dev-only AI probe hook (gitignored `ide/.env`): when set, the DeepSeek preset is
   * configured in dev with this key, so the chat needs no manual key entry. Vite
   * inlines VITE_* variables into the dev bundle; a production build never reads it.
   */
  readonly VITE_DEEPSEEK_API_KEY?: string;
  /** Model for the dev seed; defaults to the preset's `deepseek-chat`. */
  readonly VITE_DEEPSEEK_MODEL?: string;
  /** Optional base URL override for the dev seed. */
  readonly VITE_DEEPSEEK_BASE_URL?: string;
  /**
   * Opt-in live design eval (docs/DEV.md §12.1). `pnpm ai:eval` sets it, so a normal test run
   * never spends tokens even when the key above is present.
   */
  readonly VITE_DESIGN_EVAL?: string;
  /** Seeds per case for the design eval; defaults to 3. */
  readonly VITE_DESIGN_EVAL_SEEDS?: string;
}
