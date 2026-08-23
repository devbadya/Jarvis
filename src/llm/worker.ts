/// <reference lib="webworker" />
import {
  InterruptableStoppingCriteria,
  TextStreamer,
  env,
  pipeline,
  type TextGenerationPipeline,
} from '@huggingface/transformers'
import { DEFAULT_GENERATION, MODEL_DTYPE, MODEL_HOST, MODEL_ID, MODEL_PATH_TEMPLATE } from './config'
import { opfsAvailable, opfsCache } from './opfs-cache'
import { CLOSE_THINK, closeReasoning, splitReasoning } from './phases'
import type { ChatTurn, LoadProgress, MainToWorker, WorkerToMain } from './protocol'

env.remoteHost = MODEL_HOST
env.remotePathTemplate = MODEL_PATH_TEMPLATE

// Route weights to OPFS. The default Cache API backend rejects the ~440 MB
// weights file in Chrome, so the model would be re-downloaded on every visit.
if (opfsAvailable()) {
  env.useBrowserCache = false
  env.useCustomCache = true
  env.customCache = opfsCache
}

/**
 * Inference runs here rather than on the main thread: a 0.8B forward pass would
 * otherwise freeze the UI between every streamed token.
 */

let generator: TextGenerationPipeline | null = null
let loadPromise: Promise<void> | null = null
let stopper = new InterruptableStoppingCriteria()
/** Mirrors `stopper`, which does not report whether it has been tripped. */
let interrupted = false

const progressByFile = new Map<string, LoadProgress>()

function post(message: WorkerToMain): void {
  self.postMessage(message)
}

interface ProgressEvent {
  status: string
  file?: string
  loaded?: number
  total?: number
}

function onProgress(event: ProgressEvent): void {
  if (event.status === 'progress' && event.file) {
    progressByFile.set(event.file, {
      file: event.file,
      loaded: event.loaded ?? 0,
      total: event.total ?? 0,
    })
    post({ type: 'progress', files: [...progressByFile.values()] })
  } else if (event.status === 'done' && event.file) {
    const existing = progressByFile.get(event.file)
    if (existing) progressByFile.set(event.file, { ...existing, loaded: existing.total })
  }
}

async function load(): Promise<void> {
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    post({ type: 'loading', message: 'Fetching model weights' })
    generator = (await pipeline('text-generation', MODEL_ID, {
      dtype: MODEL_DTYPE,
      device: 'webgpu',
      progress_callback: onProgress,
    })) as TextGenerationPipeline

    post({ type: 'loading', message: 'Warming up the GPU' })
    post({ type: 'ready' })
  })()

  try {
    await loadPromise
  } catch (error) {
    loadPromise = null
    throw error
  }
}

const tokenIdCache = new Map<string, number | null>()

/** Resolves a marker to its id, or null when the tokenizer splits it up. */
function singleTokenId(token: string): number | null {
  const cached = tokenIdCache.get(token)
  if (cached !== undefined) return cached
  const encoded = generator?.tokenizer.encode(token, { add_special_tokens: false }) ?? []
  const id = encoded.length === 1 ? (encoded[0] ?? null) : null
  tokenIdCache.set(token, id)
  return id
}

/**
 * Stops generation at the end of the assistant's turn.
 *
 * The model's generation_config only lists `<|endoftext|>`, so without this the
 * model runs straight past `<|im_end|>` and starts writing the user's next turn.
 */
function endOfTurnTokens(): number[] {
  return ['<|im_end|>', '<|endoftext|>'].map(singleTokenId).filter((id): id is number => id !== null)
}

function countTokens(text: string): number {
  if (!text) return 0
  return generator?.tokenizer.encode(text, { add_special_tokens: false }).length ?? 0
}

/** Tokens spent reasoning, which is the quantity the strategies exist to control. */
function thinkTokenCount(text: string): number {
  return countTokens(splitReasoning(text).reasoning)
}

interface PhaseResult {
  text: string
  tokens: number
}

/**
 * One generation pass. A string input is fed to the model verbatim; an array of
 * turns goes through the chat template first.
 */
async function runPhase(
  input: string | ChatTurn[],
  options: Record<string, unknown>,
  emit: (chunk: string) => void,
): Promise<PhaseResult> {
  if (!generator) throw new Error('Model is not loaded')

  let text = ''
  let tokens = 0
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    // Tool calls and reasoning arrive as markup, so special tokens must survive.
    skip_special_tokens: false,
    callback_function: (chunk: string) => {
      text += chunk
      tokens += 1
      emit(chunk)
    },
  })

  await generator(input as string, { ...options, streamer, stopping_criteria: stopper })
  return { text, tokens }
}

/**
 * Reasoning uncapped, in a single pass: the chat template opens the think block
 * and the model runs until it stops on its own.
 */
async function generateUncapped(
  request: Extract<MainToWorker, { type: 'generate' }>,
  emit: (chunk: string) => void,
): Promise<PhaseResult> {
  return runPhase(
    request.turns,
    {
      ...DEFAULT_GENERATION,
      max_new_tokens: request.strategy.answerBudget,
      // The chat template renders these into the prompt Qwen expects for tool use.
      ...(request.tools.length > 0 ? { tools: request.tools } : {}),
      // Reaches apply_chat_template. Without it the template closes the reasoning
      // block immediately, and the model skips deciding whether a tool is needed.
      tokenizer_encode_kwargs: { enable_thinking: true },
      eos_token_id: endOfTurnTokens(),
    },
    emit,
  )
}

/**
 * Reasoning capped, in two passes.
 *
 * The chat template is rendered by hand so the prompt can be reused as a plain
 * string: the first pass fills the think block up to the budget, then the block
 * is closed and the second pass continues from there. A string input skips the
 * template, which is what makes resuming mid-turn possible at all.
 *
 * The cost is a second prefill of the whole prompt, since the KV cache does not
 * survive between pipeline calls. On a 0.8B model prefill is cheap next to
 * decode, so this buys control over the reasoning length at a few percent of the
 * turn's time.
 */
async function generateCapped(
  request: Extract<MainToWorker, { type: 'generate' }>,
  emit: (chunk: string) => void,
): Promise<PhaseResult> {
  if (!generator) throw new Error('Model is not loaded')
  const { strategy, tools, turns } = request

  const prompt = generator.tokenizer.apply_chat_template(turns, {
    tokenize: false,
    add_generation_prompt: true,
    enable_thinking: true,
    ...(tools.length > 0 ? { tools } : {}),
  } as Parameters<typeof generator.tokenizer.apply_chat_template>[1]) as unknown as string

  // Part of the reasoning trace rather than of the answer, so it is streamed as
  // such: the user sees the commitment the model was made to state.
  const preamble = strategy.routingPreamble ?? ''
  if (preamble) emit(preamble)

  const closeThink = singleTokenId(CLOSE_THINK)
  const endOfTurn = endOfTurnTokens()
  const thinking = await runPhase(
    prompt + preamble,
    {
      ...DEFAULT_GENERATION,
      max_new_tokens: strategy.thinkBudget,
      add_special_tokens: false,
      // Stopping on `</think>` keeps the budget spent on reasoning: without it a
      // model that finishes thinking early would have its answer truncated at
      // the same cap.
      eos_token_id: closeThink === null ? endOfTurn : [...endOfTurn, closeThink],
    },
    emit,
  )

  // The cap lands mid-sentence more often than not. Closing the block anyway is
  // the point: it moves the model into answering position instead of letting it
  // reason on into the region where it talks itself out of the right tool.
  const reasoning = closeReasoning(preamble + thinking.text)
  if (reasoning.appended) emit(reasoning.appended)

  // An interrupt during the first pass would otherwise be spent re-prefilling
  // the whole prompt only to stop again on the first token.
  if (interrupted) return { text: reasoning.text, tokens: thinking.tokens }

  const answer = await runPhase(
    prompt + reasoning.text,
    {
      ...DEFAULT_GENERATION,
      max_new_tokens: strategy.answerBudget,
      add_special_tokens: false,
      eos_token_id: endOfTurn,
    },
    emit,
  )

  return { text: reasoning.text + answer.text, tokens: thinking.tokens + answer.tokens }
}

async function generate(request: Extract<MainToWorker, { type: 'generate' }>): Promise<void> {
  await load()

  stopper = new InterruptableStoppingCriteria()
  interrupted = false
  const startedAt = performance.now()
  const emit = (text: string): void => post({ type: 'chunk', requestId: request.requestId, text })

  const capped = request.strategy.thinkBudget > 0
  const { text, tokens } = capped
    ? await generateCapped(request, emit)
    : await generateUncapped(request, emit)

  post({
    type: 'complete',
    requestId: request.requestId,
    text,
    tokens,
    thinkTokens: thinkTokenCount(text),
    durationMs: performance.now() - startedAt,
  })
}

self.addEventListener('message', (event: MessageEvent<MainToWorker>) => {
  const message = event.data

  if (message.type === 'interrupt') {
    interrupted = true
    stopper.interrupt()
    return
  }

  const task = message.type === 'load' ? load() : generate(message)
  task.catch((error: unknown) => {
    post({
      type: 'error',
      ...(message.type === 'generate' ? { requestId: message.requestId } : {}),
      message: error instanceof Error ? error.message : String(error),
    })
  })
})
