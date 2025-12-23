import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import PocketBase from 'pocketbase'

/**
 * Backend SDK: Auth - Login
 *
 * POST /_tk/sdk/auth/login
 * Request: { email, password }
 * Response: { user, token }
 */

const POCKETBASE_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8091'

export const POST: RequestHandler = async ({ request }) => {
	let body: { email: string; password: string }
	try {
		body = await request.json()
	} catch {
		throw error(400, 'Invalid JSON body')
	}

	if (!body.email || !body.password) {
		throw error(400, 'Missing email or password')
	}

	// Create a fresh PB client for this request
	const pb = new PocketBase(POCKETBASE_URL)

	try {
		const auth = await pb.collection('users').authWithPassword(body.email, body.password)

		return json({
			user: {
				id: auth.record.id,
				email: auth.record.email,
				name: auth.record.name,
				avatar: auth.record.avatar,
				created: auth.record.created,
				updated: auth.record.updated
			},
			token: auth.token
		})
	} catch (err: any) {
		console.error('[SDK/Auth] Login error:', err)
		throw error(401, 'Invalid email or password')
	}
}
