import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { getProjectByDomain } from '$lib/server/pb'

export const load: PageServerLoad = async ({ locals, url }) => {
	const domain = locals.domain

	// If visiting /tinykit from a domain that has a project, go to that project's studio
	if (domain && !url.searchParams.has('dashboard') && !url.searchParams.has('kit')) {
		const project = await getProjectByDomain(domain)
		if (project) {
			redirect(302, `/tinykit/studio?id=${project.id}`)
		}
		redirect(302, '/tinykit/connect-domain')
	}

	// Otherwise show the dashboard
	return {}
}
