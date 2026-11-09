import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { validateUserToken } from '$lib/server/pb'
import { SESSION_COOKIE } from '$lib/server/private-apps'

export const POST: RequestHandler = async ({ request, cookies, url }) => {
  if (request.headers.get('Origin') !== url.origin) return json({ error: 'Origin not allowed' }, { status: 403 })
  if (!await validateUserToken(request)) return json({ error: 'Sign in first.' }, { status: 401 })
  cookies.set(SESSION_COOKIE, request.headers.get('Authorization')!.slice(7), { path: '/', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 60 * 60 * 24 * 7 })
  return json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}

export const DELETE: RequestHandler = async ({ request, cookies, url }) => {
  if (request.headers.get('Origin') !== url.origin) return json({ error: 'Origin not allowed' }, { status: 403 })
  cookies.delete(SESSION_COOKIE, { path: '/' })
  return json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
