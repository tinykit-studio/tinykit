import { env } from '$env/dynamic/private'
import { error } from '@sveltejs/kit'
import { readFile, realpath } from 'node:fs/promises'
import { join, sep, extname } from 'node:path'
import { readStatus } from '../../../scripts/companion/status.mjs'
import { randomBytes } from 'node:crypto'

// This capability permits isolated preview data access only, never publishing.
export const previewCapability = randomBytes(32).toString('hex')

export function companionPreviewRequest(request: Request) {
  const url = new URL(request.url)
  const expected = new URL(env.TINYKIT_COMPANION_ORIGIN!)
  const id = env.TINYKIT_COMPANION_ID!
  return url.host === expected.host && request.headers.get('host') === expected.host &&
    (request.headers.get('origin') === 'null' || (!request.headers.get('origin') && ['GET', 'HEAD'].includes(request.method))) && url.searchParams.get('_preview') === previewCapability &&
    (url.pathname.startsWith(`/_tk/data/${id}/`) || url.pathname === `/_tk/realtime/${id}` || url.pathname.startsWith(`/_tk/assets/${id}/`))
}

export function companionEnabled() {
  return Boolean(env.TINYKIT_COMPANION_DIR && env.TINYKIT_COMPANION_ID && env.TINYKIT_COMPANION_ORIGIN)
}

export function guardCompanion(request: Request) {
  if (!companionEnabled()) error(404, 'Companion is available only through tinykit dev.')
  const expected = new URL(env.TINYKIT_COMPANION_ORIGIN!)
  const url = new URL(request.url)
  const origin = request.headers.get('origin')
  if (url.host !== expected.host || request.headers.get('host') !== expected.host || (origin && origin !== expected.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    error(403, 'Companion accepts same-origin local requests only.')
  }
}

export async function companionStatus() {
  return readStatus(env.TINYKIT_COMPANION_DIR!)
}

export async function companionAsset(filename: string) {
  if (!filename || /[/\\\x00-\x1f]/.test(filename) || filename === '.' || filename === '..') error(404, 'Asset not found')
  const root = await realpath(env.TINYKIT_COMPANION_DIR!)
  const base = await realpath(join(root, 'assets'))
  if (base !== join(root, 'assets')) error(403, 'assets/ must not be a symlink.')
  let path: string
  try { path = await realpath(join(base, filename)) } catch { error(404, 'Asset not found') }
  if (!path.startsWith(base + sep)) error(403, 'Asset must stay inside assets/.')
  const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.pdf': 'application/pdf' }
  return new Response(new Uint8Array(await readFile(path)), { headers: { 'Content-Type': types[extname(filename).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
}
