import { error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getProject, pb } from '$lib/server/pb'

export const GET: RequestHandler = async ({ params }) => {
  const project = await getProject(params.project_id)
  if (!project?.cli_publication) error(404, 'Published source asset not found')
  let record
  try {
    record = await pb.collection('_tk_source_assets').getFirstListItem(pb.filter('project = {:project} && digest = {:digest} && filename = {:filename} && published = true', { project: params.project_id, digest: params.digest, filename: params.filename }))
  } catch { error(404, 'Published source asset not found') }
  const token = await pb.files.getToken()
  const response = await fetch(pb.files.getURL(record, record.file, { token }))
  if (!response.ok) error(404, 'Source asset not found')
  return new Response(response.body, { headers: { 'Content-Type': response.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } })
}
