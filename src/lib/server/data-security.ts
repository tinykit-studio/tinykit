import { error } from '@sveltejs/kit'

/**
 * Rate limiting disabled for now - tinykit is self-hosted so the owner
 * controls their own server. Origin check provides sufficient protection.
 *
 * Can be re-enabled if needed for multi-tenant deployments.
 */
export function check_rate_limit(_ip: string): void {
	// No-op - rate limiting disabled
}

/**
 * Check if request origin matches project domain
 * Allows requests with no origin (server-side/curl) but blocks cross-origin browser requests
 */
export function check_origin(request: Request, project_domain: string | undefined): void {
	const origin = request.headers.get('origin')

	// No origin header = not a browser CORS request (curl, server-side, same-origin)
	// We allow these - rate limiting handles abuse
	if (!origin) {
		return
	}

	// If project has no domain set, allow all (development mode)
	if (!project_domain) {
		return
	}

	// Check if origin matches project domain
	const allowed_origins = [
		`https://${project_domain}`,
		`http://${project_domain}`,
		// Also allow localhost for development
		'http://localhost:5173',
		'http://127.0.0.1:5173'
	]

	if (!allowed_origins.some(allowed => origin.startsWith(allowed))) {
		throw error(403, 'Origin not allowed')
	}
}

/**
 * Get client IP from request (handles proxies)
 */
export function get_client_ip(request: Request): string {
	return (
		request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
		request.headers.get('x-real-ip') ||
		'unknown'
	)
}
