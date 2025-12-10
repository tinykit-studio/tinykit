import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { get_template } from '$lib/templates'

// GET /api/templates/[id] - Get a specific template with its code
export const GET: RequestHandler = async ({ params }) => {
	const template = get_template(params.id)

	if (!template) {
		throw error(404, 'Template not found')
	}

	return json({
		id: template.id,
		name: template.name,
		description: template.description,
		code: template.frontend_code,
		design: template.design || [],
		content: template.content || [],
		data: template.data || {}
	})
}
