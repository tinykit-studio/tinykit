import type { Handle } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getProjectByDomain } from '$lib/server/pb'

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

function loginPage(error: boolean): string {
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Login - tinykit</title>
	<style>
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body { font-family: system-ui, sans-serif; background: #0d0d0d; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
		form { background: #141414; padding: 2rem; border-radius: 8px; width: 100%; max-width: 320px; }
		h1 { font-size: 1.25rem; margin-bottom: 1.5rem; text-align: center; }
		input { width: 100%; padding: 0.75rem; border: 1px solid #333; border-radius: 4px; background: #0d0d0d; color: #fff; margin-bottom: 1rem; }
		input:focus { outline: none; border-color: #666; }
		button { width: 100%; padding: 0.75rem; border: none; border-radius: 4px; background: #fff; color: #000; font-weight: 500; cursor: pointer; }
		button:hover { background: #eee; }
		.error { color: #f87171; font-size: 0.875rem; margin-bottom: 1rem; text-align: center; }
	</style>
</head>
<body>
	<form method="POST" action="/tinykit/login">
		<h1>tinykit</h1>
		${error ? '<p class="error">Invalid password</p>' : ''}
		<input type="password" name="password" placeholder="Password" autofocus required>
		<button type="submit">Enter</button>
	</form>
</body>
</html>`
}

export const handle: Handle = async ({ event, resolve }) => {
	const url = new URL(event.request.url)
	const host = event.request.headers.get('host') || 'localhost'
	const domain = normalize_domain(host)

	// Store domain in locals for use by routes
	event.locals.domain = domain

	// Try to resolve project for this domain (async, cached per request)
	// We'll do this lazily - routes can call getProjectByDomain themselves

	// Simple password protection for /tinykit routes
	const adminPassword = env.ADMIN_PASSWORD
	if (adminPassword && url.pathname.startsWith('/tinykit')) {
		const sessionToken = event.cookies.get('crud_session')
		const validToken = Buffer.from(adminPassword).toString('base64')

		// Check for login form submission
		if (event.request.method === 'POST' && url.pathname === '/tinykit/login') {
			const formData = await event.request.formData()
			const password = formData.get('password')

			if (password === adminPassword) {
				return new Response(null, {
					status: 303,
					headers: {
						'Location': '/tinykit',
						'Set-Cookie': `crud_session=${validToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`
					}
				})
			}
			// Wrong password - show login page with error
			return new Response(loginPage(true), {
				status: 401,
				headers: { 'Content-Type': 'text/html' }
			})
		}

		// Allow login page
		if (url.pathname === '/tinykit/login') {
			return new Response(loginPage(false), {
				headers: { 'Content-Type': 'text/html' }
			})
		}

		// Check session
		if (sessionToken !== validToken) {
			return new Response(null, {
				status: 303,
				headers: { 'Location': '/tinykit/login' }
			})
		}
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

	return resolve(event)
}
