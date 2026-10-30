import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getProject, pb, withProjectLock } from '$lib/server/pb'
import { check_rate_limit, check_origin, get_client_ip } from '$lib/server/data-security'
import { adjust_counters, DataMutationError } from '$lib/server/data-mutations'

export const POST: RequestHandler = async ({params, request}) => {
  const {project_id, collection} = params
  try {
    return await withProjectLock(project_id, async () => {
      const project = await getProject(project_id)
      if (!project) throw error(404, 'Project not found')
      check_origin(request, project.domain)
      check_rate_limit(get_client_ip(request))
      const data = project.data || {}
      if (!Object.hasOwn(data, collection)) throw error(404, 'Collection not found')
      let changes
      try { changes = await request.json() } catch { throw error(400, 'Invalid counter changes') }
      const result = adjust_counters(data[collection], changes)
      const next = {...data, [collection]: {...data[collection], records: result.records}}
      await pb.collection('_tk_projects').update(project_id, {data: next})
      return json(result.items)
    })
  } catch (err: any) {
    if (err instanceof DataMutationError) throw error(err.status, err.message)
    if (err.status) throw err
    throw error(500, 'Failed to update counters')
  }
}
