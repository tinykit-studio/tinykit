import type { Handle } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getProjectByDomain, trackAvailableDomain } from '$lib/server/pb'

/**
 * Normalize a domain for matching
 * Removes port, www prefix, and lowercases
 */
function normalize_domain(host: string): string {
	return host
		.toLowerCase()
		.replace(/:\d+$/, '')  // Remove port
		.replace(/^www\./, '') // Remove www prefix
}

// CORS headers for iframe access (only allow 'null' origin from sandboxed iframes)
const cors_headers = {
	'Access-Control-Allow-Origin': 'null',
	'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
	'Access-Control-Max-Age': '86400'
}

export const handle: Handle = async ({ event, resolve }) => {
	const url = new URL(event.request.url)
	const host = event.request.headers.get('host') || 'localhost'
	const domain = normalize_domain(host)

	// Store domain in locals for use by routes
	event.locals.domain = domain

	// Handle CORS preflight for /_tk/ routes (data API, assets, realtime)
	if (url.pathname.startsWith('/_tk/') && event.request.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: cors_headers })
	}

	// Track unassigned domains for the domain picker (non-blocking)
	// Only track on non-API routes to avoid excessive DB calls
	if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/_pb/') && !url.pathname.startsWith('/_tk/')) {
		getProjectByDomain(domain).then(project => {
			if (!project) {
				trackAvailableDomain(domain)
			}
		}).catch(() => {})
	}

	// Proxy Pocketbase requests
	if (url.pathname.startsWith('/_pb/')) {
		const pbUrl = env.POCKETBASE_URL || 'http://127.0.0.1:8091'
		// Admin UI assets use relative paths from /_/, so we need to handle them specially
		// /_pb/_/... -> /_/...  (admin UI and its assets)
		// /_pb/api/... -> /api/... (API calls)
		// /_pb/libs/... -> /_/libs/... (admin assets referenced with relative paths)
		// /_pb/images/... -> /_/images/... (admin assets)
		// /_pb/assets/... -> /_/assets/... (admin assets)
		let targetPath = url.pathname.replace('/_pb/', '/')

		// Admin UI static assets need to be under /_/
		if (targetPath.startsWith('/libs/') || targetPath.startsWith('/images/') || targetPath.startsWith('/assets/') || targetPath.startsWith('/fonts/')) {
			targetPath = '/_' + targetPath
		}

		const targetUrl = `${pbUrl}${targetPath}${url.search}`

		try {
			const headers = new Headers(event.request.headers)
			headers.delete('host')
			// Don't request compressed responses - let the outer server handle compression
			headers.delete('accept-encoding')

			const response = await fetch(targetUrl, {
				method: event.request.method,
				headers,
				body: event.request.method !== 'GET' && event.request.method !== 'HEAD'
					? await event.request.arrayBuffer()
					: undefined
			})

			// Copy headers but remove content-encoding since we're proxying uncompressed
			const responseHeaders = new Headers(response.headers)
			responseHeaders.delete('content-encoding')
			responseHeaders.delete('content-length')

			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers: responseHeaders
			})
		} catch (error) {
			console.error('Pocketbase proxy error:', error)
			return new Response('Proxy error', { status: 500 })
		}
	}

	// Add CORS headers to /_tk/ responses
	if (url.pathname.startsWith('/_tk/')) {
		const response = await resolve(event)
		const headers = new Headers(response.headers)
		headers.set('Access-Control-Allow-Origin', '*')
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers
		})
	}

	return resolve(event)
}
