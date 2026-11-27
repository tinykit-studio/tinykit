import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { guardCompanion } from '$lib/server/companion'
import { env } from '$env/dynamic/private'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

let busy = false
export const POST: RequestHandler = async ({ request }) => {
  guardCompanion(request)
  if (request.headers.get('origin') !== env.TINYKIT_COMPANION_ORIGIN) error(403, 'Open the companion to open your project.')
  if (!request.headers.get('content-type')?.startsWith('application/json')) error(415, 'Expected JSON.')
  const text = await request.text()
  if (text.length > 12000) error(413, 'Request too large.')
  let payload
  try { payload = JSON.parse(text) } catch { error(400, 'Invalid request.') }
  if (!['status', 'open', 'focus', 'stop'].includes(payload?.action)) error(400, 'Unknown action.')
  if (payload.provider !== undefined && !['codex', 'claude'].includes(payload.provider)) error(400, 'Choose Codex or Claude Code.')
  if (payload.new_chat !== undefined && typeof payload.new_chat !== 'boolean') error(400, 'Choose whether to start a new chat.')
  if (payload.open_when_finished !== undefined && (typeof payload.open_when_finished !== 'boolean' || (payload.open_when_finished && payload.provider && payload.provider !== 'codex'))) error(400, 'Choose whether to open Codex when finished.')
  if (busy && payload.action === 'open') return json({ ok: false, error: 'A customization is already starting.' }, { status: 409 })
  if (payload.action === 'open') busy = true
  try {
    const result = await new Promise<any>((resolveResult, reject) => {
      const child = spawn(process.execPath, [resolve('scripts/companion/agent.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TINYKIT_COMPANION_DIR: env.TINYKIT_COMPANION_DIR } })
      let output = ''
      const timer = setTimeout(() => child.kill('SIGTERM'), 30000)
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 250000) child.kill('SIGTERM') })
      child.stderr.resume()
      child.on('error', reject)
      child.on('close', () => { clearTimeout(timer); try { resolveResult(JSON.parse(output)) } catch { reject(new Error('The coding agent could not be opened. Your project files are ready to use.')) } })
      child.stdin.on('error', () => {})
      child.stdin.end(JSON.stringify(payload))
    })
    return json(result, { headers: { 'Cache-Control': 'no-store' } })
  } finally { if (payload.action === 'open') busy = false }
}
