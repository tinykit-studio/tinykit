import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import PocketBase from 'pocketbase'

/**
 * Backend SDK: Auth - Get Current User
 *
 * GET /_tk/sdk/auth/me
 * Headers: { Authorization: Bearer <token> }
 * Response: { user } or 401
 */

const POCKETBASE_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8091'

export const GET: RequestHandler = async ({ request }) => {
	const auth_header = request.headers.get('Authorization')
	if (!auth_header?.startsWith('Bearer ')) {
		throw error(401, 'Not authenticated')
	}

	const token = auth_header.slice(7)

	// Create a fresh PB client and load the auth store
	const pb = new PocketBase(POCKETBASE_URL)
	pb.authStore.save(token, null)

	try {
		// Validate token by fetching user
		const user = await pb.collection('users').authRefresh()

		return json({
			user: {
				id: user.record.id,
				email: user.record.email,
				name: user.record.name,
				avatar: user.record.avatar,
				created: user.record.created,
				updated: user.record.updated
			}
		})
	} catch (err: any) {
		console.error('[SDK/Auth] Me error:', err)
		throw error(401, 'Invalid or expired token')
	}
}
