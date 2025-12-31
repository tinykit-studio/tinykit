import { error, redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getProject, pb } from '$lib/server/pb'

/**
 * Catch-all route for preview - serves the same HTML for any sub-path
 * This allows client-side routing to work within previewed apps
 * URL: /tinykit/preview/[id]/*
 */
export const GET: RequestHandler = async ({ params }) => {
	const { id } = params

	const project = await getProject(id)

	if (!project) {
		throw error(404, 'Project not found')
	}

	// Serve the production app (compiled HTML from file attachment)
	if (project.published_html) {
		const file_url = pb.files.getURL(project, project.published_html)
		const response = await fetch(file_url)
		if (response.ok) {
			const html = await response.text()
			return new Response(html, {
				headers: {
					'Content-Type': 'text/html; charset=utf-8'
				}
			})
		}
	}

	// If no compiled HTML yet, redirect to builder with a hint
	throw redirect(302, `/tinykit/studio?id=${id}&needs_build=true`)
}
