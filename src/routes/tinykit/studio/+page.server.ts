import type { PageServerLoad } from './$types'
import { getProject, getProjectByDomain } from '$lib/server/pb'
import { redirect } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ url, locals }) => {
	const project_id = url.searchParams.get('id')
	const domain = locals.domain

	// If ID is provided, load that project
	if (project_id) {
		const project = await getProject(project_id)
		if (project) {
			// On localhost, load directly (preserves port)
			// On production, redirect to project's domain
			const is_localhost = domain === 'localhost' || domain.startsWith('localhost:')
			if (is_localhost) {
				return { project_id: project.id }
			}
			// Redirect to the project's own domain
			const protocol = url.protocol // http: or https:
			throw redirect(302, `${protocol}//${project.domain}/tinykit/studio`)
		}
		// Project not found, redirect to dashboard
		throw redirect(302, '/tinykit/dashboard')
	}

	// Find project by current domain
	const project = await getProjectByDomain(domain)

	if (project) {
		return { project_id: project.id }
	}

	// No project for this domain - redirect to new project page
	throw redirect(302, `/tinykit/new?domain=${encodeURIComponent(domain)}`)
}
