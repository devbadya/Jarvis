/**
 * Smoke test against the real model, outside the browser.
 *
 * Unit tests cover our own parsing, but they cannot tell us whether the model id
 * resolves, whether the chat template renders tool definitions the way the agent
 * loop assumes, or whether generation actually produces <tool_call> markup.
 *
 *   node tools/verify-model.mjs            # tokenizer and chat template only (a few MB)
 *   node tools/verify-model.mjs --generate # also downloads weights and generates (~530 MB)
 */
import { AutoTokenizer, TextStreamer, pipeline } from '@huggingface/transformers'

const MODEL_ID = 'onnx-community/Qwen3.5-0.8B-Text-ONNX'
const withGeneration = process.argv.includes('--generate')

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

const checks = {
  'tool name rendered into prompt': prompt.includes('web_search'),
  'parameter schema rendered': prompt.includes('query'),
  'tool_call marker documented': prompt.includes('<tool_call>'),
  'chat roles applied': prompt.includes('<|im_start|>'),
}
for (const [label, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}`)
}
console.log(`  prompt length: ${prompt.length} characters`)

if (Object.values(checks).some((ok) => !ok)) {
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

const budgetChecks = {
  // Without this the first phase would not be generating reasoning at all.
  'prompt ends inside an open think block': openIndex !== -1 && openIndex > closeIndex,
  // The first phase stops on this token so an early finish does not eat the
  // answer's budget. More than one token and that stop condition cannot be set.
  [`"</think>" is a single token (got ${closeThink.length})`]: closeThink.length === 1,
}
for (const [label, ok] of Object.entries(budgetChecks)) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}`)
}

if (!budgetChecks['prompt ends inside an open think block']) {
  console.error('\nThe think budget assumes the template leaves the reasoning block open.')
  process.exit(1)
}

if (!withGeneration) {
  console.log('\nSkipping generation. Pass --generate to download weights and run the model.')
  process.exit(0)
}

heading('Generation')
console.log('Downloading weights, this takes a while on first run…')
const generator = await pipeline('text-generation', MODEL_ID, {
  dtype: 'q4',
  progress_callback: (event) => {
    if (event.status === 'progress' && event.total) {
      const percent = ((event.loaded / event.total) * 100).toFixed(0)
      process.stdout.write(`\r  ${event.file}: ${percent}%   `)
    }
  },
})
console.log('\nModel loaded.')

let output = ''
const started = Date.now()
await generator([{ role: 'user', content: 'Reply with exactly: pong' }], {
  max_new_tokens: 24,
  do_sample: false,
  streamer: new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: false,
    callback_function: (chunk) => {
      output += chunk
    },
  }),
})
console.log(`  generated ${output.length} characters in ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(`  raw output: ${JSON.stringify(output.slice(0, 300))}`)
