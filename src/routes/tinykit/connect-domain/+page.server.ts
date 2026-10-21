import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { getProjectByDomain } from '$lib/server/pb'

export const load: PageServerLoad = async ({ locals }) => {
	const domain = locals.domain
	if (domain) {
		const project = await getProjectByDomain(domain)
		if (project) redirect(302, `/tinykit/studio?id=${project.id}`)
	}
	return { domain }
}
