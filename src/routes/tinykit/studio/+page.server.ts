import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ url, locals }) => {
	const project_id = url.searchParams.get('id')
	const domain = locals.domain

	// Pass the project ID or domain to the client
	// The client will handle loading and validation with user auth
	return {
		project_id: project_id || null,
		domain
	}
}
