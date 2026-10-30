import type { RequestEvent } from '@sveltejs/kit'
import { getProject, getProjectByDomain, validateUserToken, type Project } from './pb'

export const SESSION_COOKIE = 'tinykit_session'

export function sessionRequest(request: Request, token?: string): Request {
  const headers = new Headers(request.headers)
  if (!headers.has('Authorization') && token) headers.set('Authorization', `Bearer ${token}`)
  return new Request(request.url, { headers })
}

/** Match every app delivery surface, including asset aliases and SPA routes. */
export async function requestProject(event: RequestEvent): Promise<Project | null> {
  let path: string
  try { path = decodeURIComponent(event.url.pathname) } catch { return null }
  const match = path.match(/^\/(?:_tk\/(?:data|realtime|config|source-assets)|tinykit\/preview|api\/projects)\/([a-z0-9]{15})(?:\/|$)/)
    || path.match(/^\/_tk\/assets\/([a-z0-9]{15})\/[^/]+$/)
  if (match) return getProject(match[1])
  if (path.startsWith('/_tk/assets/')) {
    const id = event.url.searchParams.get('project_id')
    return id ? getProject(id) : getProjectByDomain(event.locals.domain)
  }
  // App catch-all pages share a host with Studio and its infrastructure routes.
  if (event.route.id === '/' || event.route.id === '/[...path]') return getProjectByDomain(event.locals.domain)
  return null
}

export async function privateAppGuard(event: RequestEvent): Promise<{ response?: Response; private: boolean }> {
  const project = await requestProject(event)
  if (project?.visibility !== 'private') return { private: false }
  const authorization = event.request.headers.get('Authorization')
  const token = event.cookies.get(SESSION_COOKIE)
  const user = await validateUserToken(sessionRequest(event.request, token))
  const isPage = !event.url.pathname.startsWith('/_tk/') && !event.url.pathname.startsWith('/api/')
  if (!user && isPage && ['GET', 'HEAD'].includes(event.request.method)) {
    const next = event.url.pathname + event.url.search
    return { private: true, response: new Response(null, { status: 303, headers: { Location: `/login?next=${encodeURIComponent(next)}`, 'Cache-Control': 'no-store', Vary: 'Cookie, Authorization' } }) }
  }
  if (!user || !project.owner || user.id !== project.owner) return {
    private: true,
    response: Response.json({ error: user ? 'Only the app owner can access this app.' : 'Sign in to access this private app.' }, { status: user ? 403 : 401, headers: { 'Cache-Control': 'no-store', Vary: 'Cookie, Authorization' } })
  }
  // Cookie-authenticated writes must originate on this host. Bearer tokens are
  // explicitly attached by CLI/API clients and do not use ambient credentials.
  if (!authorization && !['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
    if (event.request.headers.get('Origin') !== event.url.origin) return { private: true, response: Response.json({ error: 'Origin not allowed' }, { status: 403 }) }
  }
  return { private: true }
}
