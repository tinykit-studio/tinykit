import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getProject } from '$lib/server/pb'

// GET /api/projects/:id/export - Export project data
export const GET: RequestHandler = async ({ params }) => {
	try {
		const project = await getProject(params.id)

		if (!project) {
			return json({ error: 'Project not found' }, { status: 404 })
		}

		// Return exportable project data
		return json({
			name: project.name,
			frontend_code: project.frontend_code,
			design: project.design,
			content: project.content,
			data: project.data,
			custom_instructions: project.custom_instructions,
			exported_at: new Date().toISOString()
		})
	} catch (error: any) {
		if (error.status === 404) {
			return json({ error: 'Project not found' }, { status: 404 })
		}
		console.error('Export error:', error)
		return json({ error: 'Failed to export project' }, { status: 500 })
	}
}
