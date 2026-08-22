/**
 * Text-only export of Qwen3.5-0.8B. The multimodal build ships a vision encoder
 * we never feed, needs the dedicated Qwen3_5 classes, and downloads ~150 MB more.
 */
export const MODEL_ID = 'onnx-community/Qwen3.5-0.8B-Text-ONNX'

/** INT4 weights on an fp16 graph: the smallest variant ONNX Runtime Web runs well. */
export const MODEL_DTYPE = 'q4f16'

/** Approximate on-disk size, shown before the user commits to the download. */
export const MODEL_DOWNLOAD_BYTES = 448 * 1024 * 1024

export const DEFAULT_GENERATION = {
  max_new_tokens: 1024,
  temperature: 0.7,
  top_p: 0.8,
  top_k: 20,
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
