/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL the model is downloaded from. Defaults to the Hugging Face Hub. */
  readonly VITE_MODEL_HOST?: string
  /** Path layout under that host, with {model} and {revision} placeholders. */
  readonly VITE_MODEL_PATH_TEMPLATE?: string
  /**
   * Prefix for the `search` and `fetch` proxy endpoints. Defaults to `/api`,
   * which the dev server serves itself. Set it to an empty string on a static
   * host that has no proxy.
   */
  readonly VITE_AGENT_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
