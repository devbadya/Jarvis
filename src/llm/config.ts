/**
 * Text-only export of Qwen3.5-0.8B. The multimodal build ships a vision encoder
 * we never feed, needs the dedicated Qwen3_5 classes, and downloads ~150 MB more.
 */
export const MODEL_ID = 'onnx-community/Qwen3.5-0.8B-Text-ONNX'

/** INT4 weights on an fp16 graph: the smallest variant ONNX Runtime Web runs well. */
export const MODEL_DTYPE = 'q4f16'

/** Measured total of the seven files the q4f16 variant needs. */
export const MODEL_DOWNLOAD_BYTES = 489_167_000

/**
 * Where the weights come from.
 *
 * Hugging Face is the canonical public source: it reflects any request Origin,
 * serves byte ranges, and needs no account. Point these at a mirror to remove
 * that third-party dependency — see "Hosting the model yourself" in the README.
 */
export const MODEL_HOST = import.meta.env.VITE_MODEL_HOST || 'https://huggingface.co/'

/** `{model}` and `{revision}` are substituted by Transformers.js. */
export const MODEL_PATH_TEMPLATE = import.meta.env.VITE_MODEL_PATH_TEMPLATE || '{model}/resolve/{revision}/'

/**
 * Qwen's published sampling settings for thinking mode on text tasks, minus the
 * parameters Transformers.js does not implement (`min_p`, `presence_penalty`).
 * The earlier values here were the non-thinking preset and made the model skip
 * tools roughly half the time.
 */
export const DEFAULT_GENERATION = {
  max_new_tokens: 1024,
  temperature: 1.0,
  top_p: 0.95,
  top_k: 20,
  // Qwen pairs presence_penalty=1.5 with repetition_penalty=1.0. Without the
  // former available, a light repetition penalty stands in for it.
  repetition_penalty: 1.05,
  do_sample: true,
} as const

export const SYSTEM_PROMPT = `You are Jarvis, a concise and precise assistant running entirely inside the user's browser.

Guidelines:
- Answer directly. Do not pad replies with filler.
- You have tools available. Use them whenever the answer depends on current information, an external page, or an exact calculation. Do not guess when a tool can give you the fact.
- After a tool returns, cite the source URL when you used information from the web.
- If a tool fails, say so plainly and answer with what you do know.
- Reply in the language the user writes in.`

/** Rounds of tool execution allowed per user turn before the loop is cut off. */
export const MAX_TOOL_ROUNDS = 4
