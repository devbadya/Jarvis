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

const MODEL_DTYPE = 'q4f16'

/** The weights themselves, and so the file every check below cares about most. */
const WEIGHTS_FILE = `onnx/model_${MODEL_DTYPE}.onnx_data`

/** The seven files an install fetches, largest first. */
const MODEL_FILES = [
  WEIGHTS_FILE,
  'tokenizer.json',
  `onnx/model_${MODEL_DTYPE}.onnx`,
  'tokenizer_config.json',
  'chat_template.jinja',
  'config.json',
  'generation_config.json',
]

/** MODEL_DOWNLOAD_BYTES in src/llm/config.ts. Compared loosely; see below. */
const EXPECTED_TOTAL_BYTES = 489_174_504

/**
 * The other ONNX exports of the same weights, for the size comparison below.
 * Both are multimodal: they need `Qwen3_5ForConditionalGeneration` and a vision
 * encoder this app never feeds, so they are listed to be measured, not used.
 */
const ALTERNATIVE_EXPORTS = ['onnx-community/Qwen3.5-0.8B-ONNX', 'onnx-community/Qwen3.5-0.8B-ONNX-OPT']

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
const fileBytes = new Map()
for (const path of MODEL_FILES) {
  let result
  try {
    result = await headFile(path)
  } catch (error) {
    check(false, `${path} — request failed: ${error.message}`)
    continue
  }
  totalBytes += result.bytes
  fileBytes.set(path, result.bytes)
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

/**
 * A half-gigabyte download that restarts from zero on a dropped connection is
 * one most people never finish, so `src/llm/opfs-cache.ts` continues it with a
 * Range request. That needs three things from the host, none of them ours: byte
 * ranges (checked above), a 206 that says which bytes it is sending, and an
 * entity tag a script can read — the partial is only safe to append to if the
 * remote file can be proven not to have changed. `If-Range` is not enough: the
 * Hub's CDN ignores it and answers a stale validator with 206 anyway.
 */
heading('Resumable download')

const weightsUrl = `${MODEL_HOST}${MODEL_PATH_TEMPLATE.replace('{model}', MODEL_ID).replace('{revision}', 'main')}${WEIGHTS_FILE}`
const ranged = await fetch(weightsUrl, {
  headers: { origin: ORIGIN, range: 'bytes=1024-2047' },
})
await ranged.arrayBuffer()

const exposed = (ranged.headers.get('access-control-expose-headers') ?? '').toLowerCase()
const contentRange = ranged.headers.get('content-range')
check(ranged.status === 206, `partial content honoured (HTTP ${ranged.status})`)
// The resume reads the whole file's size out of this header and refuses a
// partial whose total has moved, so the number in it has to be the real one.
check(
  contentRange === `bytes 1024-2047/${fileBytes.get(WEIGHTS_FILE)}`,
  `range states the file's total size (${contentRange})`,
)
check(Boolean(ranged.headers.get('etag')), `entity tag present (${ranged.headers.get('etag')})`)
check(exposed.includes('*') || exposed.includes('etag'), 'entity tag readable from a page, not just by curl')

if (failures.length > 0) {
  console.error('\nA broken-off install cannot be resumed against this host; it would start over.')
  process.exit(1)
}

/**
 * Whether the variant the app loads is still the smallest one published.
 *
 * The download is the single biggest thing this app asks of anyone, so "is this
 * the right export?" deserves an answer from the Hub rather than from a comment.
 */
heading('Smallest available variant')

async function variantSizes(repo) {
  const response = await fetch(`https://huggingface.co/api/models/${repo}/tree/main?recursive=true`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const sizes = new Map()
  for (const entry of await response.json()) {
    if (entry.type !== 'file') continue
    const match =
      /^onnx\/(.+?)(?:_(fp16|fp32|quantized|q4|q4f16|int8|bnb4|uint8))?\.onnx(?:_data(?:_\d+)?)?$/.exec(
        entry.path,
      )
    if (!match) continue
    const dtype = match[2] ?? 'fp32'
    sizes.set(dtype, (sizes.get(dtype) ?? 0) + (entry.size ?? 0))
  }
  return sizes
}

try {
  const sizes = await variantSizes(MODEL_ID)
  const mine = sizes.get(MODEL_DTYPE) ?? 0
  for (const [dtype, bytes] of [...sizes].sort((a, b) => a[1] - b[1])) {
    const mib = (bytes / 1024 / 1024).toFixed(1)
    console.log(`  ${dtype === MODEL_DTYPE ? '->' : '  '} ${dtype.padEnd(10)} ${mib.padStart(8)} MiB`)
  }
  check(mine > 0, `${MODEL_DTYPE} is published in ${MODEL_ID}`)
  check(
    [...sizes.values()].every((bytes) => bytes >= mine),
    `${MODEL_DTYPE} is the smallest variant in this repository`,
  )

  for (const repo of ALTERNATIVE_EXPORTS) {
    const alternative = await variantSizes(repo)
    const total = alternative.get(MODEL_DTYPE) ?? 0
    console.log(`  ${repo} at ${MODEL_DTYPE}: ${(total / 1024 / 1024).toFixed(1)} MiB`)
    check(total >= mine, `${repo} is no smaller than the export in use`)
  }
} catch (error) {
  check(false, `variant survey failed: ${error.message}`)
}

if (failures.length > 0) {
  console.error('\nA smaller export of this model may now exist. Check before shipping the larger one.')
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
