import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { guardCompanion } from '$lib/server/companion'
import { env } from '$env/dynamic/private'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

// Run the same trusted Node modules as the CLI, outside Vite's SSR transformer.
// Passwords travel through stdin; tokens stay in the ignored local runtime folder.
function invoke(payload: unknown) {
  return new Promise<any>((resolveResult, reject) => {
    const child = spawn(process.execPath, [resolve('scripts/companion/interface.mjs')], {
      stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TINYKIT_COMPANION_DIR: env.TINYKIT_COMPANION_DIR }
    })
    let output = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), 180000)
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 30000000) child.kill('SIGTERM') })
    child.stderr.resume()
    child.on('error', reject)
    child.on('close', () => {
      clearTimeout(timer)
      try { resolveResult(JSON.parse(output)) }
      catch { reject(new Error('Hosted operation stopped before returning a result. Refresh the hosted review to check its outcome.')) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(payload))
  })
}

let busy = false
export const POST: RequestHandler = async ({ request }) => {
  guardCompanion(request)
  // Require the UI origin even for clients without browser fetch metadata.
  if (request.headers.get('origin') !== env.TINYKIT_COMPANION_ORIGIN) error(403, 'Open the local companion to manage publishing.')
  if (!request.headers.get('content-type')?.startsWith('application/json')) error(415, 'Expected JSON.')
  const text = await request.text()
  if (text.length > 20000) error(413, 'Request too large.')
  let payload
  try { payload = JSON.parse(text) } catch { error(400, 'Invalid request.') }
  if (!['connection', 'connect', 'review', 'link', 'push', 'publish'].includes(payload?.action)) error(400, 'Unknown companion action.')
  const mutation = ['connect', 'link', 'push', 'publish'].includes(payload.action)
  if (mutation && busy) return json({ ok: false, error: 'Another hosted operation is in progress.' }, { status: 409 })
  if (mutation) busy = true
  try { return json(await invoke(payload), { headers: { 'Cache-Control': 'no-store' } }) }
  finally { if (mutation) busy = false }
}
