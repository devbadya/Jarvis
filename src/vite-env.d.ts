/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL the model is downloaded from. Defaults to the Hugging Face Hub. */
  readonly VITE_MODEL_HOST?: string
  /** Path layout under that host, with {model} and {revision} placeholders. */
  readonly VITE_MODEL_PATH_TEMPLATE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
