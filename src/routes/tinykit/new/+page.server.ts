import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ url, locals }) => {
	// Get domain from query param or from current request domain
	const domain = url.searchParams.get('domain') || locals.domain
	return { domain }
}
