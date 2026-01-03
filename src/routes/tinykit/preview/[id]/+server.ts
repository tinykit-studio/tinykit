import { error, redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getProject, pb } from '$lib/server/pb'

// Escape HTML to prevent XSS
function escape_html(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

/**
 * Preview route - serves production HTML by project ID
 * Useful for projects without a domain assigned
 * URL: /tinykit/preview/[id]
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

	// If no compiled HTML yet, show a placeholder with the preview URL
	const safe_name = escape_html(project.name || 'Project')
	const safe_url = escape_html(project.domain ? `https://${project.domain}` : `/tinykit/preview/${id}`)
	const placeholder = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${safe_name}</title>
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			background: #0d0d0d;
			color: #666;
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			text-align: center;
			padding: 2rem;
		}
		.message { max-width: 400px; }
		h1 { font-size: 1.25rem; font-weight: 500; margin-bottom: 0.5rem; color: #888; }
		p { font-size: 0.875rem; margin-bottom: 1rem; }
		.url { font-family: monospace; font-size: 0.8rem; color: #555; word-break: break-all; }
	</style>
</head>
<body>
	<div class="message">
		<h1>${safe_name}</h1>
		<p>Not deployed yet</p>
		<div class="url">${safe_url}</div>
	</div>
</body>
</html>`
	return new Response(placeholder, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8'
		}
	})
}
