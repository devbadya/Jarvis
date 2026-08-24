/**
 * Text-only export of Qwen3.5-0.8B, which is the smallest way to run this model
 * through Transformers.js and the one its own text-generation support was added
 * for (huggingface/transformers.js#1602).
 *
 * The two multimodal exports of the same weights, `-ONNX` and `-ONNX-OPT`, need
 * the dedicated `Qwen3_5ForConditionalGeneration` class and a vision encoder
 * this app never feeds; at q4f16 they come to 616 MiB against 448 MiB here.
 * Every other Qwen3.5-0.8B ONNX repository on the Hub is a copy of one of the
 * three. `node tools/verify-model.mjs` re-checks that against the Hub.
 */
export const MODEL_ID = 'onnx-community/Qwen3.5-0.8B-Text-ONNX'

/**
 * INT4 weights on an fp16 graph: the smallest of the five variants published,
 * ahead of q4 at 526 MiB, int8 at 896 MiB, fp16 at 1.4 GiB and fp32 at 2.9 GiB.
 *
 * 448 MiB is the floor for this model rather than a choice worth revisiting.
 * Qwen3.5 has no size below 0.8B, and a 248,320-token vocabulary tied to the
 * output layer is why 0.8B parameters at four bits land here instead of nearer
 * 400 MB.
 */
export const MODEL_DTYPE = 'q4f16'

/** The weights themselves, and so what an install is mostly waiting for. */
export const MODEL_WEIGHTS_FILE = `onnx/model_${MODEL_DTYPE}.onnx_data`

/** Measured total of the seven files the q4f16 variant needs. */
export const MODEL_DOWNLOAD_BYTES = 489_174_504

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

/**
 * Corrections allowed per user turn when the answer check finds a problem.
 *
 * One. Every correction is another full generation on a 0.8B model the user is
 * waiting for, and a second pass over the same answer has nothing new to go on
 * — the evidence the first correction was built from has not changed.
 */
export const MAX_CORRECTIONS = 1

/**
 * How generation is split between reasoning and answering.
 *
 * Reasoning length is not a neutral knob for a model this small. Sweeping the
 * chain-of-thought budget on Qwen2.5-1.5B against BFCL v3 produces a strongly
 * non-monotonic curve: 44% correct tool selection with no reasoning, 71.5% at 16
 * tokens, then a collapse to 25% at 256 tokens and 22.5% at 512, with invented
 * function names rising from under 1% to 20% over the same range
 * (arXiv:2604.02155). Past roughly a hundred tokens the model reasons its way
 * *into* the wrong tool rather than merely running out of format discipline.
 *
 * `thinkBudget` caps the reasoning phase so generation cannot wander into that
 * region. `routingPreamble` is seeded into the reasoning block so the model's
 * first tokens must name the tool it intends to use, which in the same paper
 * drove invented tool names to zero.
 *
 * Which of these actually helps *this* model is an empirical question, not a
 * settled one — see `src/eval`. Qwen3.5 is reasoning-trained, and this app has
 * already established that switching thinking off entirely makes tool use worse,
 * so the strategies below cap reasoning rather than remove it.
 */
export interface GenerationStrategy {
  id: string
  /** Tokens allowed inside the reasoning block. Zero leaves it uncapped. */
  thinkBudget: number
  /** Tokens allowed for the answer or tool call that follows. */
  answerBudget: number
  /** Seeded into the reasoning block to force an early tool commitment. */
  routingPreamble: string | null
}

/**
 * `routed` adapts the paper's template, which assumes a tool call is always
 * required. A general assistant must also be able to decline, so the model is
 * offered `none` rather than forced onto a tool name.
 */
export const ROUTING_PREAMBLE = 'Tool needed: '

export const STRATEGIES = {
  /** Current shipped behaviour: reasoning runs until the model stops. */
  baseline: { id: 'baseline', thinkBudget: 0, answerBudget: 1024, routingPreamble: null },
  capped: { id: 'capped', thinkBudget: 32, answerBudget: 512, routingPreamble: null },
  routed: { id: 'routed', thinkBudget: 32, answerBudget: 512, routingPreamble: ROUTING_PREAMBLE },
  /** Deliberately in the collapsed region, to confirm the curve reproduces here. */
  verbose: { id: 'verbose', thinkBudget: 256, answerBudget: 512, routingPreamble: null },
} as const satisfies Record<string, GenerationStrategy>

export type StrategyId = keyof typeof STRATEGIES

/**
 * Stays on the measured-safe default until the eval says otherwise. Changing
 * this is the point of the harness, not something to guess at.
 */
export const DEFAULT_STRATEGY = STRATEGIES.baseline
