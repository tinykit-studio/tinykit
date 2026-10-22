import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getLLMSettings, validateUserToken, unauthorizedResponse } from '$lib/server/pb'
import { env } from '$env/dynamic/private'
import { is_configured, settings_from_env } from '$lib/ai/config'

// GET /api/settings/llm-status - Check if LLM is configured
export const GET: RequestHandler = async ({ request }) => {
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	const settings = await getLLMSettings()
	const configured = is_configured(settings)
	return json({ configured, source: configured ? (settings_from_env(env) ? 'env' : 'settings') : null })
}
