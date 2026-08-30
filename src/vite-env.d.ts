/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL the model is downloaded from. Defaults to the Hugging Face Hub. */
  readonly VITE_MODEL_HOST?: string
  /** Path layout under that host, with {model} and {revision} placeholders. */
  readonly VITE_MODEL_PATH_TEMPLATE?: string
  /**
   * Origin of the optional tool proxy. `same-origin` (or an empty value) means
   * this page's `/api`. Unset on the Pages build, so tools stay browser-direct.
   */
  readonly VITE_AGENT_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
