import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { pb } from '$lib/server/pb'
import PocketBase from 'pocketbase'

const PB_URL = 'http://127.0.0.1:8091'

async function isAuthenticated(request: Request): Promise<boolean> {
	// Check for PB auth token in Authorization header or cookie
	const authHeader = request.headers.get('Authorization')
	const cookies = request.headers.get('Cookie') || ''

	// Extract token from cookie (PB stores as pb_auth)
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

	// Verify token with PB
	try {
		const testPb = new PocketBase(PB_URL)
		testPb.authStore.save(token, null)
		await testPb.collection('users').authRefresh()
		return true
	} catch {
		return false
	}
}

// GET /api/settings?key=llm
export const GET: RequestHandler = async ({ url, request }) => {
	if (!await isAuthenticated(request)) {
		return json({ error: 'Unauthorized' }, { status: 401 })
	}
	const key = url.searchParams.get('key')
	if (!key) {
		return json({ error: 'Missing key parameter' }, { status: 400 })
	}

	try {
		const record = await pb.collection('_tk_settings').getOne(key)
		return json({ value: record.value })
	} catch (err: any) {
		if (err.status === 404) {
			return json({ value: null })
		}
		console.error('Failed to get settings:', err)
		return json({ error: 'Failed to get settings' }, { status: 500 })
	}
}

// POST /api/settings
// Body: { key: string, value: any }
export const POST: RequestHandler = async ({ request }) => {
	if (!await isAuthenticated(request)) {
		return json({ error: 'Unauthorized' }, { status: 401 })
	}

	try {
		const { key, value } = await request.json()

		if (!key) {
			return json({ error: 'Missing key' }, { status: 400 })
		}

		try {
			// Try to update existing
			await pb.collection('_tk_settings').update(key, { value })
		} catch (err: any) {
			if (err.status === 404) {
				// Create new
				await pb.collection('_tk_settings').create({ id: key, value })
			} else {
				throw err
			}
		}

		return json({ success: true })
	} catch (err: any) {
		console.error('Failed to save settings:', err)
		return json({ error: err.message || 'Failed to save settings' }, { status: 500 })
	}
}
