/**
 * Smoke test against the real model, outside the browser.
 *
 * Unit tests cover our own parsing, but they cannot tell us whether the weights
 * are still where the app expects them, whether the host will let a browser
 * fetch them, or whether the chat template renders tool definitions the way the
 * agent loop assumes. All three are properties of someone else's service and
 * change without notice, so they are checked rather than assumed.
 *
 *   node tools/verify-model.mjs
 *
 * It downloads a few MB — the tokenizer, and headers for everything else.
 *
 * This deliberately stops short of generating. The model's Gated DeltaNet layers
 * need `CausalConvWithState`, which ONNX Runtime Web implements and the Node
 * build does not, so a generation here downloads half a gigabyte and then dies
 * with "is not a registered function/op". Anything behavioural belongs in the
 * eval harness at /?eval, which runs where the model actually works.
 *
 * Point VITE_MODEL_HOST and VITE_MODEL_PATH_TEMPLATE at a mirror to check that
 * mirror instead. The CORS and range-request checks below are exactly the two
 * requirements the README's "Hosting the model yourself" section lists.
 */
import { AutoTokenizer } from '@huggingface/transformers'

const MODEL_ID = 'onnx-community/Qwen3.5-0.8B-Text-ONNX'

/** Mirrors the defaults in src/llm/config.ts, which this file cannot import. */
const MODEL_HOST = process.env.VITE_MODEL_HOST || 'https://huggingface.co/'
const MODEL_PATH_TEMPLATE = process.env.VITE_MODEL_PATH_TEMPLATE || '{model}/resolve/{revision}/'

/** The seven files an install fetches, largest first. */
const MODEL_FILES = [
  'onnx/model_q4f16.onnx_data',
  'tokenizer.json',
  'onnx/model_q4f16.onnx',
  'tokenizer_config.json',
  'chat_template.jinja',
  'config.json',
  'generation_config.json',
]

/** MODEL_DOWNLOAD_BYTES in src/llm/config.ts. Compared loosely; see below. */
const EXPECTED_TOTAL_BYTES = 489_167_000

/**
 * The app fetches these from a page, so every request is cross-origin. Using the
 * real deployment origin makes the check answer the question that matters.
 */
const ORIGIN = 'https://devbadya.github.io'

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web and return ranked results.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query' } },
        required: ['query'],
      },
    },
  },
]

function heading(text) {
  console.log(`\n=== ${text} ===`)
}

const failures = []

function check(ok, label) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}`)
  if (!ok) failures.push(label)
}

/**
 * Confirms a browser could download this file.
 *
 * The Hub answers with a redirect to a CDN, so redirects are followed and the
 * headers that matter are read off the final response. `access-control-allow-origin`
 * comes back as the reflected origin from the Hub and as `*` from the CDN;
 * either lets a browser read the body.
 */
async function headFile(path) {
  const url = `${MODEL_HOST}${MODEL_PATH_TEMPLATE.replace('{model}', MODEL_ID).replace('{revision}', 'main')}${path}`
  const response = await fetch(url, { method: 'HEAD', headers: { origin: ORIGIN } })
  const allowOrigin = response.headers.get('access-control-allow-origin')
  return {
    ok: response.ok,
    status: response.status,
    bytes: Number(response.headers.get('content-length') ?? 0),
    ranges: response.headers.get('accept-ranges') === 'bytes',
    cors: allowOrigin === '*' || allowOrigin === ORIGIN,
  }
}

heading('Weight availability')
console.log(`  host: ${MODEL_HOST}`)

let totalBytes = 0
for (const path of MODEL_FILES) {
  let result
  try {
    result = await headFile(path)
  } catch (error) {
    check(false, `${path} — request failed: ${error.message}`)
    continue
  }
  totalBytes += result.bytes
  check(
    result.ok,
    `${path} — ${result.ok ? `${result.status}, ${result.bytes.toLocaleString()} bytes` : `HTTP ${result.status}`}`,
  )
  if (!result.ok) continue
  check(result.cors, `${path} — readable from ${ORIGIN}`)
  check(result.ranges, `${path} — serves byte ranges`)
}

/**
 * Loose on purpose: a tweak to chat_template.jinja moves this by a few KB, and
 * failing on that would be noise. A different model behind the same id would
 * miss by far more than a percent.
 */
const drift = Math.abs(totalBytes - EXPECTED_TOTAL_BYTES) / EXPECTED_TOTAL_BYTES
check(
  drift < 0.01,
  `total is ${totalBytes.toLocaleString()} bytes, within 1% of the expected ${EXPECTED_TOTAL_BYTES.toLocaleString()}`,
)

if (failures.length > 0) {
  console.error(
    '\nThe weights are not where the app expects them, or the host will not let a browser read them.',
  )
  console.error('If the third-party conversion was renamed or removed, mirror it — see the README.')
  process.exit(1)
}

heading('Tokenizer and chat template')
const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)
console.log('Tokenizer loaded.')

const messages = [
  { role: 'system', content: 'You are Jarvis.' },
  { role: 'user', content: 'What is the weather in Berlin right now?' },
]

const prompt = tokenizer.apply_chat_template(messages, {
  add_generation_prompt: true,
  tokenize: false,
  tools: TOOLS,
})

check(prompt.includes('web_search'), 'tool name rendered into prompt')
check(prompt.includes('query'), 'parameter schema rendered')
check(prompt.includes('<tool_call>'), 'tool_call marker documented')
check(prompt.includes('<|im_start|>'), 'chat roles applied')
console.log(`  prompt length: ${prompt.length} characters`)

if (failures.length > 0) {
  console.error('\nChat template did not render tools as the agent loop expects.')
  process.exit(1)
}

/**
 * The capped reasoning strategies render the prompt themselves and then resume
 * generation from a plain string, which only works if two things hold. Both are
 * properties of someone else's template and tokenizer, so they are checked here
 * rather than assumed.
 */
heading('Reasoning budget preconditions')

const thinkingPrompt = tokenizer.apply_chat_template(messages, {
  add_generation_prompt: true,
  tokenize: false,
  tools: TOOLS,
  enable_thinking: true,
})

const closeThink = tokenizer.encode('</think>', { add_special_tokens: false })
const openIndex = thinkingPrompt.lastIndexOf('<think>')
const closeIndex = thinkingPrompt.lastIndexOf('</think>')

// Without this the first phase would not be generating reasoning at all.
check(openIndex !== -1 && openIndex > closeIndex, 'prompt ends inside an open think block')
// The first phase stops on this token so an early finish does not eat the
// answer's budget. More than one token and that stop condition cannot be set.
check(closeThink.length === 1, `"</think>" is a single token (got ${closeThink.length})`)

if (failures.length > 0) {
  console.error('\nThe capped reasoning strategies cannot work against this template and tokenizer.')
  process.exit(1)
}

console.log('\nEverything Node can check passed.')
console.log('Tool use and answer quality need a GPU: pnpm dev, then /?eval.')
