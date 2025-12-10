import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'

// Redirect /tinykit/[id] to /tinykit/studio?id=[id]
// This maintains backwards compatibility with old URLs
export const load: PageServerLoad = async ({ params, url }) => {
	const tab = url.searchParams.get('tab')
	let redirect_url = `/tinykit/studio?id=${params.id}`
	if (tab) {
		redirect_url += `&tab=${tab}`
	}
	throw redirect(302, redirect_url)
}
