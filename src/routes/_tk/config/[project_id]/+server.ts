import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { appProjectForRequest } from '$lib/server/private-apps'
import { transform_content_fields } from '$lib/compiler/content-utils'

// Public, authored display fields only. Never return project settings, source,
// credentials, chat history, records, or the PocketBase project object here.
export const GET: RequestHandler = async ({ params, locals }) => {
	const project = await appProjectForRequest(locals, params.project_id)
	if (!project?.published_html) error(404, 'Published app not found')
	const definition = project.source_bundle ? project : project.cli_publication?.definition || project
	return json({
		content: transform_content_fields(definition.content || [], project.id),
		design: Object.fromEntries((definition.design || []).map((field: any) => [field.css_var, field.value]))
	}, { headers: { 'Cache-Control': 'no-store' } })
}
