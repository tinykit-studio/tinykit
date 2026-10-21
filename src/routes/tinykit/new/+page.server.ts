import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { getProjectByDomain } from '$lib/server/pb'

export const load: PageServerLoad = async ({ url }) => {
	// Only the explicit domain-connection flow assigns a domain to a new app.
	const domain = (url.searchParams.get('domain') || '').trim().toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '')
	if (domain) {
		const project = await getProjectByDomain(domain)
		if (project) redirect(302, `/tinykit/studio?id=${project.id}`)
	}
	return { domain }
}
