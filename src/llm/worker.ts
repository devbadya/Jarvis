/// <reference lib="webworker" />
import {
  AutoProcessor,
  InterruptableStoppingCriteria,
  Qwen3_5ForConditionalGeneration,
  TextStreamer,
  type Processor,
} from '@huggingface/transformers'
import { DEFAULT_GENERATION, MODEL_DTYPE, MODEL_ID } from './config'
import type { LoadProgress, MainToWorker, WorkerToMain } from './protocol'

/**
 * Inference runs here rather than on the main thread: a 0.8B forward pass would
 * otherwise freeze the UI between every streamed token.
 */

type Model = Awaited<ReturnType<typeof Qwen3_5ForConditionalGeneration.from_pretrained>>

let processor: Processor | null = null
let model: Model | null = null
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
    post({ type: 'loading', message: 'Downloading tokenizer and processor' })
    processor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback: onProgress })

    post({ type: 'loading', message: 'Downloading model weights (~600 MB, cached after the first run)' })
    model = await Qwen3_5ForConditionalGeneration.from_pretrained(MODEL_ID, {
      dtype: MODEL_DTYPE,
      device: 'webgpu',
      progress_callback: onProgress,
    })

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

async function generate(request: Extract<MainToWorker, { type: 'generate' }>): Promise<void> {
  await load()
  if (!processor || !model) throw new Error('Model is not loaded')

  stopper = new InterruptableStoppingCriteria()

  const prompt = processor.apply_chat_template(request.turns, {
    add_generation_prompt: true,
    tokenize: false,
    ...(request.tools.length > 0 ? { tools: request.tools } : {}),
  }) as string

  const inputs = await processor(prompt)

  let text = ''
  let tokens = 0
  const startedAt = performance.now()

  const streamer = new TextStreamer(processor.tokenizer!, {
    skip_prompt: true,
    skip_special_tokens: false,
    callback_function: (chunk: string) => {
      text += chunk
      tokens += 1
      post({ type: 'chunk', requestId: request.requestId, text: chunk })
    },
  })

  await model.generate({
    ...inputs,
    ...DEFAULT_GENERATION,
    max_new_tokens: request.maxNewTokens ?? DEFAULT_GENERATION.max_new_tokens,
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
