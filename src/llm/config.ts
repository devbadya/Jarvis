/**
 * Qwen3.5-0.8B is a hybrid Gated-DeltaNet/attention model with a vision encoder.
 * Transformers.js only supports it through the dedicated Qwen3_5 classes, not the
 * generic `pipeline` helper, and only on the v4 preview line.
 */
export const MODEL_ID = 'onnx-community/Qwen3.5-0.8B-ONNX-OPT'

/** Per-submodule quantisation: q4 weights with an fp16 vision tower is the WebGPU sweet spot. */
export const MODEL_DTYPE = {
  embed_tokens: 'q4',
  vision_encoder: 'fp16',
  decoder_model_merged: 'q4',
} as const

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
