import { env } from '$env/dynamic/private'

// Forward the builder's identity; PocketBase enforces the project's rules and
// performs revision checks and mutation in the same database transaction.
export async function hostedRequest(request: Request, id: string, action: 'status' | 'draft' | 'publish' | 'create') {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return Response.json({ message: 'Sign in to Tinykit before using hosted commands.' }, { status: 401 })
  if (!/^[a-z0-9]{15}$/.test(id)) return Response.json({ message: 'Invalid project ID.' }, { status: 400 })
  const body = request.method === 'POST' ? await request.text() : undefined
  if (body && Buffer.byteLength(body) > 10000000) return Response.json({ message: 'Hosted request exceeds 10 MB.' }, { status: 413 })
  const response = await fetch(`${env.POCKETBASE_URL || 'http://127.0.0.1:8091'}/api/tinykit/projects/${id}/${action}`, {
    method: request.method, headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body, redirect: 'error'
  })
  return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
