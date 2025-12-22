import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import PocketBase from 'pocketbase'

const PB_URL = 'http://127.0.0.1:8091'

async function isAuthenticated(request: Request): Promise<boolean> {
	const authHeader = request.headers.get('Authorization')
	const cookies = request.headers.get('Cookie') || ''
	const pbAuthMatch = cookies.match(/pb_auth=([^;]+)/)
	const cookieData = pbAuthMatch ? decodeURIComponent(pbAuthMatch[1]) : null

	let token: string | null = null

	if (authHeader?.startsWith('Bearer ')) {
		token = authHeader.slice(7)
	} else if (cookieData) {
		try {
			const parsed = JSON.parse(cookieData)
			token = parsed.token
		} catch {}
	}

	if (!token) return false

	try {
		const testPb = new PocketBase(PB_URL)
		testPb.authStore.save(token, null)
		await testPb.collection('users').authRefresh()
		return true
	} catch {
		return false
	}
}

async function isSetupMode(): Promise<boolean> {
	// Allow unauthenticated validation only when no users exist (initial setup)
	try {
		const testPb = new PocketBase(PB_URL)
		const users = await testPb.collection('users').getList(1, 1)
		return users.totalItems === 0
	} catch {
		return false
	}
}

interface ValidateRequest {
	provider: string
	api_key: string
	base_url?: string
}

async function validate_openai(api_key: string, base_url?: string): Promise<{ valid: boolean, error?: string }> {
	const url = base_url ? `${base_url}/models` : 'https://api.openai.com/v1/models'
	try {
		const res = await fetch(url, {
			headers: { 'Authorization': `Bearer ${api_key}` }
		})
		if (res.ok) return { valid: true }
		if (res.status === 401) return { valid: false, error: 'Invalid API key' }
		return { valid: false, error: `API returned ${res.status}` }
	} catch (err: any) {
		return { valid: false, error: err.message || 'Connection failed' }
	}
}

async function validate_anthropic(api_key: string): Promise<{ valid: boolean, error?: string }> {
	// Anthropic requires a POST to /messages, we'll send a minimal request
	try {
		const res = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'x-api-key': api_key,
				'anthropic-version': '2023-06-01',
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				model: 'claude-3-haiku-20240307',
				max_tokens: 1,
				messages: [{ role: 'user', content: 'hi' }]
			})
		})
		// 200 = valid, 401 = invalid key, 400 = valid key but bad request (still means key works)
		if (res.ok) return { valid: true }
		if (res.status === 401) return { valid: false, error: 'Invalid API key' }
		if (res.status === 400) {
			// Key is valid but request was bad - this shouldn't happen with our request
			// but we'll treat it as valid since auth passed
			return { valid: true }
		}
		const data = await res.json().catch(() => ({}))
		return { valid: false, error: data.error?.message || `API returned ${res.status}` }
	} catch (err: any) {
		return { valid: false, error: err.message || 'Connection failed' }
	}
}

async function validate_gemini(api_key: string): Promise<{ valid: boolean, error?: string }> {
	// Gemini uses query param for key
	try {
		const res = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${api_key}`)
		if (res.ok) return { valid: true }
		if (res.status === 400 || res.status === 403) return { valid: false, error: 'Invalid API key' }
		return { valid: false, error: `API returned ${res.status}` }
	} catch (err: any) {
		return { valid: false, error: err.message || 'Connection failed' }
	}
}

// POST /api/settings/validate-llm
// Body: { provider: string, api_key: string, base_url?: string }
export const POST: RequestHandler = async ({ request }) => {
	// Allow either authenticated users OR during initial setup (no users exist)
	const authenticated = await isAuthenticated(request)
	const setupMode = await isSetupMode()

	if (!authenticated && !setupMode) {
		return json({ error: 'Unauthorized' }, { status: 401 })
	}

	try {
		const { provider, api_key, base_url } = await request.json() as ValidateRequest

		if (!provider || !api_key) {
			return json({ error: 'Missing provider or api_key' }, { status: 400 })
		}

		let result: { valid: boolean, error?: string }

		switch (provider) {
			case 'openai':
				result = await validate_openai(api_key, base_url)
				break
			case 'anthropic':
				result = await validate_anthropic(api_key)
				break
			case 'gemini':
				result = await validate_gemini(api_key)
				break
			default:
				return json({ error: `Unknown provider: ${provider}` }, { status: 400 })
		}

		return json(result)
	} catch (err: any) {
		console.error('Validation error:', err)
		return json({ valid: false, error: err.message || 'Validation failed' }, { status: 500 })
	}
}
