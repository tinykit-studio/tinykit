import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { list_templates } from '$lib/templates'
import { validateUserToken, unauthorizedResponse } from '$lib/server/pb'

// GET /api/templates - List available templates
export const GET: RequestHandler = async ({ request }) => {
	// Require authentication
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	return json(list_templates())
}
