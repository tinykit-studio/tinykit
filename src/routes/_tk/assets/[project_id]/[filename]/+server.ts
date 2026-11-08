import { error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { pb } from '$lib/server/pb'
import { appProjectForRequest } from '$lib/server/private-apps'

/**
 * Assets Proxy API - Serve project assets (path-based project_id)
 *
 * GET /_tk/assets/{project_id}/{filename} - Get asset file
 *
 * This route handles the path-based format used in preview mode,
 * allowing clean query params for thumb/download options.
 *
 * Built-in placeholders (no project lookup needed):
 *   - placeholder.jpg - Generic square placeholder
 *   - placeholder-avatar.jpg - Circular avatar placeholder
 *   - placeholder-wide.jpg - 16:9 banner placeholder
 *
 * Query params:
 *   - thumb: Thumbnail size, e.g. "100x100" (optional, for images)
 *   - download: Force download instead of preview (optional)
 */

// SVG placeholder templates
const PLACEHOLDERS: Record<string, { svg: string; aspectRatio: string }> = {
	'placeholder.jpg': {
		aspectRatio: '1/1',
		svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
			<rect width="200" height="200" fill="#e5e7eb"/>
			<path d="M80 70a15 15 0 1 1 0 30 15 15 0 0 1 0-30zm60 80H60l30-40 20 25 15-20 15 35z" fill="#9ca3af"/>
		</svg>`
	},
	'placeholder-avatar.jpg': {
		aspectRatio: '1/1',
		svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
			<rect width="200" height="200" fill="#e5e7eb"/>
			<circle cx="100" cy="75" r="35" fill="#9ca3af"/>
			<path d="M100 120c-40 0-60 20-60 50v30h120v-30c0-30-20-50-60-50z" fill="#9ca3af"/>
		</svg>`
	},
	'placeholder-wide.jpg': {
		aspectRatio: '16/9',
		svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
			<rect width="320" height="180" fill="#e5e7eb"/>
			<path d="M100 60a20 20 0 1 1 0 40 20 20 0 0 1 0-40zm140 100H80l50-65 35 40 25-30 50 55z" fill="#9ca3af"/>
		</svg>`
	}
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const { project_id, filename } = params
	const thumb = url.searchParams.get('thumb')

	// Handle built-in placeholders (no project lookup needed)
	if (filename.startsWith('placeholder')) {
		const placeholder = PLACEHOLDERS[filename] || PLACEHOLDERS['placeholder.jpg']
		return new Response(placeholder.svg, {
			status: 200,
			headers: {
				'Content-Type': 'image/svg+xml',
				'Cache-Control': 'public, max-age=31536000, immutable'
			}
		})
	}

	try {
		const project = await appProjectForRequest(locals, project_id)

		if (!project) {
			throw error(404, 'Project not found')
		}

		// Check if file exists in project assets
		const assets = project.assets || []
		if (!assets.includes(filename)) {
			throw error(404, 'Asset not found')
		}

		// Build Pocketbase file URL
		const file_url = pb.files.getURL(
			{ id: project.id, collectionId: project.collectionId || '_tk_projects' },
			filename,
			{ ...(thumb ? { thumb } : {}), token: await pb.files.getToken() }
		)

		// Proxy the file from Pocketbase
		const response = await fetch(file_url)

		if (!response.ok) {
			throw error(response.status, 'Failed to fetch asset')
		}

		// Get content type from response
		const content_type = response.headers.get('content-type') || 'application/octet-stream'

		// Return the file with appropriate headers
		return new Response(response.body, {
			status: 200,
			headers: {
				'Content-Type': content_type,
				'Cache-Control': 'public, max-age=31536000, immutable'
			}
		})
	} catch (err: any) {
		if (err.status) {
			throw err
		}
		console.error('[Assets API] Error:', err)
		throw error(500, 'Failed to serve asset')
	}
}
