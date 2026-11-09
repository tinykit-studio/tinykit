import type { RequestHandler } from './$types'
import { hostedRequest } from '$lib/server/hosted'
export const POST: RequestHandler = ({ request, params }) => hostedRequest(request, params.id, 'publish')
