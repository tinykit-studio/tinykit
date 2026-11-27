import type { RequestEvent } from '@sveltejs/kit'
import { getProject, getProjectByDomain, isSetupComplete, validateUserToken, type Project } from './pb'

export const SESSION_COOKIE = 'tinykit_session'

export function sessionRequest(request: Request, token?: string): Request {
  const headers = new Headers(request.headers)
  if (!headers.has('Authorization') && token) headers.set('Authorization', `Bearer ${token}`)
  return new Request(request.url, { headers })
}

export function isAppPage(route: string) {
  return route === '/' || route === '/[...path]' || route.startsWith('/tinykit/preview/')
}

// The local companion has its own access guard and doesn't resolve appProject.
export function appProjectForRequest(locals: App.Locals, id: string) {
  return locals.appProject === undefined ? getProject(id) : locals.appProject
}

/** Use the same decoded route parameters as the handlers that serve app data. */
async function requestProject(event: RequestEvent): Promise<Project | null | undefined> {
  const route = event.route.id || ''
  if (event.url.pathname.startsWith('/_pb/')) return
  const strict = { strict: true }
  if (route.startsWith('/_tk/') && event.params.project_id) return getProject(event.params.project_id, strict)
  if ((route.startsWith('/tinykit/preview/') || route.startsWith('/api/projects/')) && event.params.id) return getProject(event.params.id, strict)
  if (route === '/_tk/assets/[filename]') {
    if (event.params.filename?.startsWith('placeholder')) return null
    const id = event.url.searchParams.get('project_id')
    return id ? getProject(id, strict) : getProjectByDomain(event.locals.domain, strict)
  }
  // Before initial setup, the root and catch-all handlers redirect to /setup.
  if (isAppPage(route)) return await isSetupComplete() ? getProjectByDomain(event.locals.domain, strict) : null
}

export async function privateAppGuard(event: RequestEvent): Promise<{ response?: Response; private: boolean }> {
  let project: Project | null | undefined
  try {
    project = await requestProject(event)
  } catch (error) {
    console.error('[Private apps] Could not verify project access:', error instanceof Error ? error.message : String(error))
    return { private: false, response: Response.json({ error: 'Could not verify app access. Try again shortly.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }) }
  }
  event.locals.appProject = project
  if (project?.visibility !== 'private') return { private: false }
  const authorization = event.request.headers.get('Authorization')
  if (!authorization && event.request.headers.get('Origin') === 'null') {
    return { private: true, response: Response.json({ error: 'Origin not allowed' }, { status: 403, headers: { 'Cache-Control': 'no-store' } }) }
  }
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
