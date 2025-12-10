import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getProjectByDomain, isSetupComplete, pb } from '$lib/server/pb'
import { env } from '$env/dynamic/private'

const PB_URL = env.POCKETBASE_URL || 'http://127.0.0.1:8091'

export const GET: RequestHandler = async ({ locals }) => {
	// Check if setup is needed first
	const setup_complete = await isSetupComplete()
	if (!setup_complete) {
		throw redirect(302, '/setup')
	}

	const domain = locals.domain

	// Try to find a project for this domain
	const project = await getProjectByDomain(domain)

	if (project) {
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

		// If no compiled HTML yet, redirect to builder
		throw redirect(302, '/tinykit/studio')
	}

	// No project for this domain - redirect to new project page
	throw redirect(302, `/tinykit/new?domain=${encodeURIComponent(domain)}`)
}
