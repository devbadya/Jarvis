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
import type { LoadProgress, MainToWorker, WorkerToMain } from './protocol'

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

let cachedEosTokens: number[] | null = null

/**
 * Stops generation at the end of the assistant's turn.
 *
 * The model's generation_config only lists `<|endoftext|>`, so without this the
 * model runs straight past `<|im_end|>` and starts writing the user's next turn.
 */
function endOfTurnTokens(): number[] {
  if (cachedEosTokens) return cachedEosTokens
  const tokenizer = generator?.tokenizer
  const ids = ['<|im_end|>', '<|endoftext|>'].flatMap((token) => {
    const encoded = tokenizer?.encode(token, { add_special_tokens: false }) ?? []
    return encoded.length === 1 ? encoded : []
  })
  cachedEosTokens = ids
  return ids
}

async function generate(request: Extract<MainToWorker, { type: 'generate' }>): Promise<void> {
  await load()
  if (!generator) throw new Error('Model is not loaded')

  stopper = new InterruptableStoppingCriteria()

  let text = ''
  let tokens = 0
  const startedAt = performance.now()

  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    // Tool calls and reasoning arrive as markup, so special tokens must survive.
    skip_special_tokens: false,
    callback_function: (chunk: string) => {
      text += chunk
      tokens += 1
      post({ type: 'chunk', requestId: request.requestId, text: chunk })
    },
  })

  await generator(request.turns, {
    ...DEFAULT_GENERATION,
    max_new_tokens: request.maxNewTokens ?? DEFAULT_GENERATION.max_new_tokens,
    // The chat template renders these into the prompt Qwen expects for tool use.
    ...(request.tools.length > 0 ? { tools: request.tools } : {}),
    // Reaches apply_chat_template. Without it the template closes the reasoning
    // block immediately, and the model skips deciding whether a tool is needed.
    tokenizer_encode_kwargs: { enable_thinking: true },
    eos_token_id: endOfTurnTokens(),
    streamer,
    stopping_criteria: stopper,
  })

  post({
    type: 'complete',
    requestId: request.requestId,
    text,
    tokens,
    durationMs: performance.now() - startedAt,
  })
}

self.addEventListener('message', (event: MessageEvent<MainToWorker>) => {
  const message = event.data

  if (message.type === 'interrupt') {
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
