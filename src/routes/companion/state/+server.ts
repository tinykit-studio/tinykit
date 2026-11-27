import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { companionStatus, guardCompanion, previewCapability } from '$lib/server/companion'
import { getProject } from '$lib/server/pb'
import { env } from '$env/dynamic/private'
import { writeAtomic } from '../../../../scripts/companion/workspace.mjs'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

export const GET: RequestHandler = async ({ request }) => {
  guardCompanion(request)
  const status = await companionStatus()
  const project = await getProject(status.project_id)
  if (!project) error(503, 'Local app is not ready.')
  if (project.settings?.companion_revision !== status.source_revision) error(503, 'Importing a new source revision.')
  return json({ status, project, preview_capability: previewCapability }, { headers: { 'Cache-Control': 'no-store' } })
}

// Serialize reports so a slower, older compile cannot replace a newer attempt.
let reportQueue: Promise<unknown> = Promise.resolve()
export const POST: RequestHandler = async ({ request }) => {
  guardCompanion(request)
  const text = await request.text()
  if (text.length > 40000) error(413, 'Compile report is too large.')
  let report: any
  try { report = JSON.parse(text) } catch { error(400, 'Expected a JSON compile report.') }
  if (!['pending', 'success', 'error'].includes(report.state) || typeof report.revision !== 'string' || typeof report.attempt !== 'string' || report.attempt.length > 80 || (report.error !== undefined && typeof report.error !== 'string')) error(400, 'Invalid compile report.')
  const write = async () => {
    const status = await companionStatus()
    if (report.revision !== `${status.session_id}:${status.source_revision}` || status.import_error) error(409, 'Compile report belongs to an older source revision.')
    const path = join(env.TINYKIT_COMPANION_DIR!, '.tinykit/compile.json')
    if (report.state !== 'pending') {
      let current: any
      try { current = JSON.parse(await readFile(path, 'utf8')) } catch {}
      if (current?.revision !== report.revision || current?.attempt !== report.attempt) error(409, 'Compile attempt is no longer current.')
    }
    const result = { revision: report.revision, attempt: report.attempt, state: report.state, ...(report.error ? { error: report.error } : {}), checked_at: new Date().toISOString() }
    await writeAtomic(path, result)
    return json({ ok: true })
  }
  const result = reportQueue.then(write, write)
  reportQueue = result.catch(() => {})
  return result
}
