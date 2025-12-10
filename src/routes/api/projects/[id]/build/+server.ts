import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { pb, validateUserToken, unauthorizedResponse } from '$lib/server/pb'

// POST /api/projects/:id/build - Save build output as file attachment
export const POST: RequestHandler = async ({ params, request }) => {
	// Require authentication
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	try {
		const { html } = await request.json()

		if (!html) {
			return json({ error: 'html is required' }, { status: 400 })
		}

		// Create a FormData with the HTML file
		const form_data = new FormData()
		const blob = new Blob([html], { type: 'text/html' })
		form_data.append('published_html', blob, 'index.html')

		// Save the built HTML as a file attachment
		await pb.collection('_tk_projects').update(params.id, form_data)

		return json({
			success: true,
			size: html.length
		})
	} catch (error: any) {
		if (error.status === 404) {
			return json({ error: 'Project not found' }, { status: 404 })
		}
		console.error('Build save error:', error)
		const error_message = error.response?.data || error.message || String(error)
		console.error('Build save error details:', JSON.stringify(error_message, null, 2))
		return json({ error: `${error.message || error}: ${JSON.stringify(error_message)}` }, { status: 500 })
	}
}
