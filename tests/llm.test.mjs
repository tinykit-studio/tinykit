import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'

const temp = await mkdtemp(join(tmpdir(), 'tinykit-llm-'))
const outfile = join(temp, 'llm.mjs')
await build({ stdin: { contents: `export * from './src/lib/ai/config'; export * from './src/lib/ai/model'; export { generateText, streamText, tool } from 'ai'; export { z } from 'zod';`, resolveDir: process.cwd() }, outfile, bundle: true, platform: 'node', format: 'esm' })
const { normalize_base_url, merge_settings, is_configured, settings_from_env, get_model, get_summary_model, generateText, streamText, tool, z } = await import(pathToFileURL(outfile))
after(() => rm(temp, { recursive: true, force: true }))

const local = { provider: 'openai-compatible', api_key: '', model: 'local-coder', base_url: 'http://localhost:1234/v1/' }

test('local configurations need a URL and model, but no key', () => {
 assert.equal(is_configured(local), true)
 assert.equal(is_configured({ ...local, base_url: '' }), false)
 assert.equal(is_configured({ ...local, model: '' }), false)
 assert.equal(is_configured({ ...local, provider: 'anthropic' }), false)
 assert.equal(is_configured({ ...local, provider: 'openai' }), true)
})
test('normalizes URLs and rejects unsupported schemes and embedded secrets', () => {
 assert.equal(normalize_base_url(' http://localhost:1234/v1/// '), 'http://localhost:1234/v1')
 for (const url of ['file:///tmp/key', 'ftp://localhost', 'https://user:pass@server', 'https://server?token=secret', 'https://server#fragment']) assert.throws(() => normalize_base_url(url))
})
test('saved keys are preserved only for the same endpoint; empty explicitly clears', () => {
 const saved = { ...local, api_key: 'saved-key' }
 const { api_key, ...omitted } = local
 assert.equal(merge_settings(omitted, saved).api_key, 'saved-key')
 assert.equal(merge_settings({ ...omitted, base_url: 'http://localhost:9999/v1' }, saved).api_key, '')
 assert.equal(merge_settings({ ...omitted, provider: 'openai' }, saved).api_key, '')
 assert.equal(merge_settings(local, saved).api_key, '')
 assert.throws(() => merge_settings({ provider: 'deepseek', model: 'deepseek-flash' }, saved))
})
test('environment configuration recognizes keyless endpoints', () => {
 assert.equal(settings_from_env({}), null)
 assert.equal(is_configured(settings_from_env({ LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: local.base_url, LLM_MODEL: local.model })), true)
 assert.equal(settings_from_env({ LLM_PROVIDER: 'deepseek', LLM_API_KEY: 'key' }).model, 'deepseek-flash')
})
test('default OpenAI keeps Responses; custom endpoints and DeepSeek use Chat Completions', () => {
 assert.match(get_model({ provider: 'openai', apiKey: 'test', model: 'test' }).provider, /responses/)
 for (const provider of ['openai', 'openai-compatible', 'deepseek']) assert.match(get_model({ provider, apiKey: '', model: 'test', baseUrl: local.base_url }).provider, /chat/)
 assert.match(get_model({ provider: 'deepseek', apiKey: 'test', model: 'test' }).provider, /chat/)
 assert.throws(() => get_model({ provider: 'openai-compatible', apiKey: 'test', model: 'test' }))
})
test('builder and summaries use the custom server and selected model, including streaming tool calls', async () => {
 const requests = []
 const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  requests.push({ path: req.url, authorization: req.headers.authorization, body })
  if (body.stream) {
   res.writeHead(200, { 'content-type': 'text/event-stream' })
   for (const chunk of [
    { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'save', arguments: '{"text":"hello"}' } }] }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }
   ]) res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: body.model, ...chunk })}\n\n`)
   res.end('data: [DONE]\n\n')
  } else {
   res.writeHead(200, { 'content-type': 'application/json' })
   res.end(JSON.stringify({ id: 'test', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: 'Saved the note' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }))
  }
 })
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
 try {
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1/`
  const config = { provider: 'openai-compatible', apiKey: '', model: 'only-local-model', baseUrl }
  let saved
  const result = streamText({ model: get_model(config), prompt: 'Save hello', tools: { save: tool({ inputSchema: z.object({ text: z.string() }), execute: async ({ text }) => { saved = text; return 'ok' } }) } })
  await result.consumeStream()
  assert.equal(saved, 'hello')
  assert.equal((await result.toolResults)[0].output, 'ok')
  for (const provider of ['openai-compatible', 'openai', 'deepseek']) {
   assert.equal((await generateText({ model: get_summary_model({ ...config, provider, apiKey: 'custom-key' }), prompt: 'Summarize' })).text, 'Saved the note')
  }
  assert.equal(requests.length, 4)
  for (const request of requests) {
   assert.equal(request.path, '/v1/chat/completions')
   assert.equal(request.body.model, 'only-local-model')
  }
  assert.equal(requests[0].authorization, undefined)
  assert.equal(requests[1].authorization, 'Bearer custom-key')
 } finally { await new Promise(resolve => server.close(resolve)) }
})
