import type { PageServerLoad } from './$types'
import { guardCompanion } from '$lib/server/companion'

export const load: PageServerLoad = ({ request }) => {
  guardCompanion(request)
  return {}
}
