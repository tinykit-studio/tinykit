import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'

// Redirect /tinykit to /tinykit/studio
export const load: PageServerLoad = async () => {
	throw redirect(302, '/tinykit/studio')
}
