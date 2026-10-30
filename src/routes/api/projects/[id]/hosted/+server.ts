import type { RequestHandler } from './$types'
import { hostedRequest } from '$lib/server/hosted'
export const GET: RequestHandler = ({ request, params }) => hostedRequest(request, params.id, 'status')
