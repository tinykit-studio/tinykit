import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateUserToken, unauthorizedResponse } from '$lib/server/pb';

// This would reset the agent conversation history
// For now, it's a placeholder - agent instance is created per-request in prompt endpoint

export const POST: RequestHandler = async ({ request }) => {
	// Require authentication
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	return json({ success: true, message: 'Conversation cleared' });
};
