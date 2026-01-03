import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { createProject, listProjects, validateUserToken, unauthorizedResponse } from '$lib/server/pb'
import { get_template } from '$lib/templates'

// GET /api/projects - List all projects
export const GET: RequestHandler = async ({ request }) => {
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	try {
		const projects = await listProjects()
		return json(projects)
	} catch (error: any) {
		console.error('Failed to list projects:', error)
		return json({ error: 'Failed to list projects' }, { status: 500 })
	}
}

// POST /api/projects - Create a new project
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	try {
		const { name, domain, kit, template_id, initial_prompt } = await request.json()

		if (!name) {
			return json({ error: 'Name is required' }, { status: 400 })
		}

		// Use provided domain or fall back to current domain
		const project_domain = domain || locals.domain || 'localhost'

		// Get template code if specified
		let frontend_code = ''
		let design: any[] = []
		let content: any[] = []

		if (template_id) {
			const template = get_template(template_id)
			if (template) {
				frontend_code = template.frontend_code
				design = template.design || []
				content = template.content || []
			}
		}

		const project = await createProject({
			name,
			domain: project_domain,
			kit,
			frontend_code,
			design,
			content,
			initial_prompt
		})

		return json(project)
	} catch (error: any) {
		console.error('Failed to create project:', error)
		return json({ error: 'Failed to create project' }, { status: 500 })
	}
}
