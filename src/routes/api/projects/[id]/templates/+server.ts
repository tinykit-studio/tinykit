import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { updateProject, validateUserToken, unauthorizedResponse } from '$lib/server/pb'
import { get_template } from '$lib/templates'

// POST /api/projects/:id/templates - Apply a template to project
export const POST: RequestHandler = async ({ params, request }) => {
	// Require authentication
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	try {
		const { templateId } = await request.json()

		if (!templateId) {
			return json({ error: 'templateId is required' }, { status: 400 })
		}

		const template = get_template(templateId)
		if (!template) {
			return json({ error: 'Template not found' }, { status: 404 })
		}

		await updateProject(params.id, {
			frontend_code: template.frontend_code,
			design: template.design || [],
			content: template.content || [],
			data: template.data || {}
		})

		return json({ success: true })
	} catch (error: any) {
		if (error.status === 404) {
			return json({ error: 'Project not found' }, { status: 404 })
		}
		console.error('Template apply error:', error)
		return json({ error: String(error) }, { status: 500 })
	}
}
