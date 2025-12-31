import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getAvailableDomains, validateUserToken, unauthorizedResponse } from '$lib/server/pb'

export const GET: RequestHandler = async ({ request }) => {
	// Require auth
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse()
	}

	const domains = await getAvailableDomains()
	return json({ domains })
}
