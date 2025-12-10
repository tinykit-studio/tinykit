import type { RequestHandler } from './$types'

// Domains that are blocked for security (internal networks, etc.)
const BLOCKED_PATTERNS = [
	/^localhost$/i,
	/^127\./,
	/^192\.168\./,
	/^10\./,
	/^172\.(1[6-9]|2[0-9]|3[0-1])\./,
	/^0\./,
	/^::1$/,
	/^fc00:/i,
	/^fe80:/i
]

function is_blocked_host(hostname: string): boolean {
	return BLOCKED_PATTERNS.some(pattern => pattern.test(hostname))
}

// GET /api/proxy?url=<encoded-url>
// Proxies external requests to bypass CORS restrictions
// Supports range requests for audio/video seeking
export const GET: RequestHandler = async ({ url, request }) => {
	const target_url = url.searchParams.get('url')

	if (!target_url) {
		return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		})
	}

	// Validate URL format
	let parsed_url: URL
	try {
		parsed_url = new URL(target_url)
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid URL format' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		})
	}

	// Only allow http/https
	if (!['http:', 'https:'].includes(parsed_url.protocol)) {
		return new Response(JSON.stringify({ error: 'Only HTTP/HTTPS URLs allowed' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		})
	}

	// Block internal network requests
	if (is_blocked_host(parsed_url.hostname)) {
		return new Response(JSON.stringify({ error: 'Internal network URLs not allowed' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' }
		})
	}

	try {
		// Forward relevant headers from the original request
		const forward_headers: HeadersInit = {}

		// Forward range header for audio/video seeking
		const range_header = request.headers.get('Range')
		if (range_header) {
			forward_headers['Range'] = range_header
		}

		// Forward accept header
		const accept_header = request.headers.get('Accept')
		if (accept_header) {
			forward_headers['Accept'] = accept_header
		}

		const response = await fetch(target_url, {
			headers: forward_headers,
			redirect: 'follow'
		})

		// Build response headers
		const response_headers = new Headers()

		// CORS headers
		response_headers.set('Access-Control-Allow-Origin', '*')
		response_headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
		response_headers.set('Access-Control-Allow-Headers', 'Range')
		response_headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')

		// Forward content headers
		const content_type = response.headers.get('Content-Type')
		if (content_type) {
			response_headers.set('Content-Type', content_type)
		}

		const content_length = response.headers.get('Content-Length')
		if (content_length) {
			response_headers.set('Content-Length', content_length)
		}

		// Forward range response headers (important for audio/video)
		const accept_ranges = response.headers.get('Accept-Ranges')
		if (accept_ranges) {
			response_headers.set('Accept-Ranges', accept_ranges)
		}

		const content_range = response.headers.get('Content-Range')
		if (content_range) {
			response_headers.set('Content-Range', content_range)
		}

		// Cache for 1 hour (helps with repeated requests)
		response_headers.set('Cache-Control', 'public, max-age=3600')

		// Rewrite root-relative URLs in HTML to absolute URLs
		if (content_type?.includes('text/html')) {
			const origin = new URL(target_url).origin
			let html = await response.text()

			// /path → https://origin.com/path
			html = html.replace(
				/(src|href|poster|action)=(["'])(\/[^"']+)\2/g,
				(_, attr, quote, path) => `${attr}=${quote}${origin}${path}${quote}`
			)

			return new Response(html, {
				status: response.status,
				headers: response_headers
			})
		}

		return new Response(response.body, {
			status: response.status,
			headers: response_headers
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to fetch URL'
		return new Response(JSON.stringify({ error: message }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		})
	}
}

// Handle preflight requests
export const OPTIONS: RequestHandler = async () => {
	return new Response(null, {
		status: 204,
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, OPTIONS',
			'Access-Control-Allow-Headers': 'Range',
			'Access-Control-Max-Age': '86400'
		}
	})
}
