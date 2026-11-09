import type { Handle } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getProjectByDomain, trackAvailableDomain } from '$lib/server/pb'
import { companionEnabled, guardCompanion, companionAsset, companionPreviewRequest } from '$lib/server/companion'
import { isAppPage, privateAppGuard } from '$lib/server/private-apps'
import { withLegacyBrowserStorage } from '$lib/server/legacy-browser-storage.js'

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

// Published public apps and uploaded documents are untrusted. An opaque
// origin lets them run without sharing the Studio session or browser storage.
function isolateAppContent(response: Response) {
	const headers = new Headers(response.headers)
	headers.append('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-popups allow-downloads allow-modals')
	headers.set('X-Content-Type-Options', 'nosniff')
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export const handle: Handle = async ({ event, resolve }) => {
	const url = new URL(event.request.url)
	const host = event.request.headers.get('host') || 'localhost'
	const domain = normalize_domain(host)

	// Store domain in locals for use by routes
	event.locals.domain = domain

	// This separate local mode exposes only the companion and its isolated app data.
	// It never opens Studio administration or a PocketBase proxy without login.
	if (companionEnabled()) {
		const isolatedPreview = companionPreviewRequest(event.request)
		if (!isolatedPreview) guardCompanion(event.request)
		if (isolatedPreview && event.request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors_headers })
		const finish = (response: Response) => {
			if (isolatedPreview) for (const [key, value] of Object.entries(cors_headers)) response.headers.set(key, value)
			return response
		}
		const id = env.TINYKIT_COMPANION_ID!
		const assetPrefix = `/_tk/assets/${id}/`
		if (url.pathname.startsWith(assetPrefix) && event.request.method === 'GET') {
			const filename = decodeURIComponent(url.pathname.slice(assetPrefix.length))
			if (!filename.startsWith('placeholder')) {
				try { return finish(await companionAsset(filename)) } catch (err: any) {
					// Files uploaded while using the preview live in its isolated PocketBase.
					if (err.status !== 404) throw err
				}
			}
			return finish(await resolve(event))
		}
		if (url.pathname === '/companion' || url.pathname === '/companion/state' || url.pathname === '/companion/hosted' || url.pathname === '/companion/agent' || url.pathname.startsWith(`/_tk/data/${id}/`) || url.pathname === `/_tk/realtime/${id}`) return finish(await resolve(event))
		return new Response('Not available in the local companion.', { status: 404 })
	}

	const access = await privateAppGuard(event)
	if (access.response) return access.response
	const route = event.route.id || ''
	// The SvelteKit form exception for opaque origins is only for public app
	// data uploads. Keep the same-origin requirement on every other surface.
	if (event.request.headers.get('origin') === 'null' && !['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
		if (access.private || !route.startsWith('/_tk/data/')) {
			return new Response('Origin not allowed', { status: 403 })
		}
	}
	const untrustedFile = route.startsWith('/_tk/assets/') || route.startsWith('/_tk/source-assets/') || route === '/api/proxy'
	if (access.private) {
		const resolved = await resolve(event)
		const response = untrustedFile ? isolateAppContent(resolved) : resolved
		const headers = new Headers(response.headers)
		headers.set('Cache-Control', 'private, no-store')
		headers.set('Vary', 'Cookie, Authorization')
		headers.set('X-Content-Type-Options', 'nosniff')
		return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
	}

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

			const proxied = new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers: responseHeaders
			})
			// The PocketBase API also serves uploaded files, including HTML and SVG.
			return targetPath.startsWith('/_/') ? proxied : isolateAppContent(proxied)
		} catch (error) {
			console.error('Pocketbase proxy error:', error)
			return new Response('Proxy error', { status: 500 })
		}
	}

	// Add CORS headers to /_tk/ responses
	if (url.pathname.startsWith('/_tk/')) {
		const resolved = await resolve(event)
		const response = untrustedFile ? isolateAppContent(resolved) : resolved
		const headers = new Headers(response.headers)
		headers.set('Access-Control-Allow-Origin', '*')
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers
		})
	}

	const response = await resolve(event)
	const isPublicAppHtml = isAppPage(route) && response.headers.get('Content-Type')?.startsWith('text/html')
	if (!untrustedFile && !isPublicAppHtml) return response
	const isolated = isolateAppContent(response)
	const project = event.locals.appProject
	if (isPublicAppHtml && isolated.ok && project?.published_html && project.legacy_storage_html) {
		isolated.headers.delete('Content-Length')
		isolated.headers.delete('ETag')
		isolated.headers.set('Cache-Control', 'no-store')
		return new Response(withLegacyBrowserStorage(await isolated.text()), {
			status: isolated.status, statusText: isolated.statusText, headers: isolated.headers
		})
	}
	return isolated
}
