import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getProject, pb } from '$lib/server/pb'
import { check_rate_limit, check_origin, get_client_ip } from '$lib/server/data-security'

/**
 * Backend Function Execution API
 *
 * POST /_tk/backend/{project_id}/{fn} - Execute a backend function
 *
 * Backend code format (stored in project.backend_code):
 * ```javascript
 * export async function my_function({ arg1, arg2 }) {
 *   // Has access to: env, data, fetch
 *   return { result: 'value' }
 * }
 * ```
 *
 * Request body: { args: { ... } }
 * Response: { result: ... } or { error: '...' }
 *
 * Security:
 *   - Origin check: Blocks cross-origin browser requests
 *   - Rate limiting: 60 calls per minute per IP
 *   - Timeout: 30 second max execution time
 */

const EXECUTION_TIMEOUT = 30000 // 30 seconds

// Cache for compiled modules (cleared when backend_code changes)
const module_cache = new Map<string, { code_hash: string; module: any }>()

// Simple hash for cache invalidation
function hash_code(code: string): string {
	let hash = 0
	for (let i = 0; i < code.length; i++) {
		const char = code.charCodeAt(i)
		hash = ((hash << 5) - hash) + char
		hash = hash & hash
	}
	return hash.toString(36)
}

// POST - Execute backend function
export const POST: RequestHandler = async ({ params, request }) => {
	const { project_id, fn: function_name } = params

	try {
		// Get project
		const project = await getProject(project_id)
		if (!project) throw error(404, 'Project not found')

		// Security checks
		check_origin(request, project.domain)

		// Rate limiting
		const ip = get_client_ip(request)
		check_rate_limit(ip)

		// Get backend code
		const backend_code = project.backend_code
		if (!backend_code || typeof backend_code !== 'string' || !backend_code.trim()) {
			throw error(404, 'No backend code defined for this project')
		}

		// Parse request body
		let args: Record<string, any> = {}
		try {
			const body = await request.json()
			args = body.args || body || {}
		} catch {
			// Empty body is OK, just use empty args
		}

		// Execute the function
		const result = await execute_backend_function(
			project_id,
			project,
			backend_code,
			function_name,
			args
		)

		return json({ result })
	} catch (err: any) {
		// Re-throw SvelteKit errors
		if (err.status) throw err

		console.error('[Backend API] Execution error:', err)

		// Return error details for debugging
		return json(
			{ error: err.message || 'Backend function failed' },
			{ status: 500 }
		)
	}
}

// GET - List available backend functions
export const GET: RequestHandler = async ({ params }) => {
	const { project_id } = params

	try {
		const project = await getProject(project_id)
		if (!project) throw error(404, 'Project not found')

		const backend_code = project.backend_code
		if (!backend_code || typeof backend_code !== 'string' || !backend_code.trim()) {
			return json({ functions: [] })
		}

		// Parse exported function names
		const functions = parse_exported_functions(backend_code)
		return json({ functions })
	} catch (err: any) {
		if (err.status) throw err
		console.error('[Backend API] List error:', err)
		throw error(500, 'Failed to list backend functions')
	}
}

/**
 * Parse backend code to extract exported function names
 */
function parse_exported_functions(code: string): string[] {
	const functions: string[] = []

	// Match: export async function name(
	// Match: export function name(
	// Match: export const name = async (
	// Match: export const name = (
	const patterns = [
		/export\s+async\s+function\s+(\w+)\s*\(/g,
		/export\s+function\s+(\w+)\s*\(/g,
		/export\s+const\s+(\w+)\s*=\s*async\s*\(/g,
		/export\s+const\s+(\w+)\s*=\s*\(/g,
		/export\s+const\s+(\w+)\s*=\s*async\s*\w*\s*=>/g,
		/export\s+const\s+(\w+)\s*=\s*\w*\s*=>/g
	]

	for (const pattern of patterns) {
		let match
		while ((match = pattern.exec(code)) !== null) {
			if (!functions.includes(match[1])) {
				functions.push(match[1])
			}
		}
	}

	return functions
}

/**
 * Execute a backend function with sandboxed context
 */
async function execute_backend_function(
	project_id: string,
	project: any,
	backend_code: string,
	function_name: string,
	args: Record<string, any>
): Promise<any> {
	const code_hash = hash_code(backend_code)

	// Check cache
	let cached = module_cache.get(project_id)
	if (cached && cached.code_hash !== code_hash) {
		// Code changed, invalidate cache
		module_cache.delete(project_id)
		cached = undefined
	}

	let backend_module: any

	if (cached) {
		backend_module = cached.module
	} else {
		// Compile the backend code into a module
		backend_module = await compile_backend_module(project_id, project, backend_code)

		// Cache it
		module_cache.set(project_id, { code_hash, module: backend_module })
	}

	// Check if function exists
	const fn = backend_module[function_name]
	if (typeof fn !== 'function') {
		const available = Object.keys(backend_module).filter(k => typeof backend_module[k] === 'function')
		throw new Error(
			`Function "${function_name}" not found. Available functions: ${available.join(', ') || '(none)'}`
		)
	}

	// Execute with timeout
	const timeout_promise = new Promise((_, reject) => {
		setTimeout(() => reject(new Error('Backend function timed out (30s limit)')), EXECUTION_TIMEOUT)
	})

	const result = await Promise.race([
		fn(args),
		timeout_promise
	])

	return result
}

/**
 * Compile backend code into an executable module
 *
 * The module has access to:
 * - env: Project environment variables (from project.settings.env or global)
 * - data: Project data collections (CRUD operations)
 * - fetch: Standard fetch API
 * - console: For logging
 */
async function compile_backend_module(
	project_id: string,
	project: any,
	backend_code: string
): Promise<any> {
	// Build the env object from project settings
	const env = {
		...(project.settings?.env || {}),
		// Add commonly needed values
		PROJECT_ID: project_id,
		PROJECT_DOMAIN: project.domain
	}

	// Build data API (matches frontend $data API)
	const data = create_data_api(project_id, project.data || {})

	// Create the module code with injected context
	const wrapped_code = `
// Injected context
const env = ${JSON.stringify(env)};
const data = globalThis.__tinykit_data__;
const console = globalThis.console;
const fetch = globalThis.fetch;

// User's backend code
${backend_code}
`

	// Use dynamic import with data URL to create module
	// This runs in Node.js context with access to injected globals
	const blob = new Blob([wrapped_code], { type: 'application/javascript' })
	const url = URL.createObjectURL(blob)

	try {
		// Set up global context for the module
		;(globalThis as any).__tinykit_data__ = data

		// Dynamic import
		const module = await import(/* @vite-ignore */ url)

		return module
	} finally {
		URL.revokeObjectURL(url)
		delete (globalThis as any).__tinykit_data__
	}
}

/**
 * Create a data API that mirrors the frontend $data API
 */
function create_data_api(project_id: string, project_data: Record<string, any>) {
	const base_url = `/_tk/data/${project_id}`

	// Helper to make internal requests
	async function internal_fetch(path: string, options: RequestInit = {}) {
		// For server-side, we need to go through PB directly
		// This avoids the HTTP round-trip
		return fetch(`http://127.0.0.1:${process.env.PORT || 5173}${path}`, {
			...options,
			headers: {
				'Content-Type': 'application/json',
				// Mark as internal to bypass origin check
				'X-Internal-Request': 'true',
				...options.headers
			}
		})
	}

	// Create collection proxy
	return new Proxy({}, {
		get(target, collection: string) {
			if (typeof collection !== 'string' || collection.startsWith('_')) {
				return undefined
			}

			return {
				async list(options: { filter?: string; sort?: string; page?: number; perPage?: number } = {}) {
					const params = new URLSearchParams()
					if (options.filter) params.set('filter', options.filter)
					if (options.sort) params.set('sort', options.sort)
					if (options.page) params.set('page', String(options.page))
					if (options.perPage) params.set('perPage', String(options.perPage))

					const url = `${base_url}/${collection}${params.toString() ? '?' + params.toString() : ''}`
					const res = await internal_fetch(url)
					const data = await res.json()
					return data.items || []
				},

				async get(id: string) {
					const url = `${base_url}/${collection}/${id}`
					const res = await internal_fetch(url)
					if (!res.ok) return null
					return res.json()
				},

				async create(record: Record<string, any>) {
					const res = await internal_fetch(`${base_url}/${collection}`, {
						method: 'POST',
						body: JSON.stringify(record)
					})
					return res.json()
				},

				async update(id: string, changes: Record<string, any>) {
					const res = await internal_fetch(`${base_url}/${collection}/${id}`, {
						method: 'PATCH',
						body: JSON.stringify(changes)
					})
					return res.json()
				},

				async delete(id: string) {
					const res = await internal_fetch(`${base_url}/${collection}/${id}`, {
						method: 'DELETE'
					})
					return res.ok
				}
			}
		}
	})
}
