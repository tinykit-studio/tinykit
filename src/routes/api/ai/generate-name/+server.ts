import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { env } from '$env/dynamic/private'
import { validateUserToken, unauthorizedResponse } from '$lib/server/pb'

const LLM_PROVIDER = (env.LLM_PROVIDER as 'openai' | 'anthropic' | 'zai') || 'openai'
const LLM_API_KEY = env.LLM_API_KEY || ''
const LLM_MODEL = env.LLM_MODEL || 'gpt-4o-mini'
const LLM_BASE_URL = env.LLM_BASE_URL

/**
 * Generate a short project name from a user prompt
 * POST /api/ai/generate-name
 * Body: { prompt: string }
 * Returns: { name: string }
 */
export const POST: RequestHandler = async ({ request }) => {
	// Require authentication
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	try {
		const { prompt } = await request.json()

		if (!prompt) {
			return json({ error: 'Prompt required' }, { status: 400 })
		}

		if (!LLM_API_KEY) {
			// Fallback to simple extraction if no API key configured
			return json({ name: generate_fallback_name(prompt) })
		}

		const system_prompt = `Generate a short project name (2-3 words) from this app description. Be simple and descriptive, not clever. Title case, no quotes or punctuation. Just output the name.

Examples:
- "make me a todo list app" → "Todo List"
- "I want to track my expenses" → "Expense Tracker"
- "build a calculator" → "Calculator"
- "create a notes app with markdown support" → "Markdown Notes"
- "pomodoro timer with breaks" → "Pomodoro Timer"`

		let name: string

		if (LLM_PROVIDER === 'anthropic') {
			const response = await fetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': LLM_API_KEY,
					'anthropic-version': '2023-06-01'
				},
				body: JSON.stringify({
					model: LLM_MODEL.startsWith('claude-') ? LLM_MODEL : 'claude-3-haiku-20240307',
					max_tokens: 50,
					system: system_prompt,
					messages: [{ role: 'user', content: prompt }]
				})
			})

			if (!response.ok) {
				console.error('Anthropic API error:', await response.text())
				return json({ name: generate_fallback_name(prompt) })
			}

			const data = await response.json()
			name = data.content?.[0]?.text?.trim() || generate_fallback_name(prompt)
		} else if (LLM_PROVIDER === 'zai') {
			const response = await fetch(LLM_BASE_URL || 'https://api.zeno.ai/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${LLM_API_KEY}`
				},
				body: JSON.stringify({
					model: LLM_MODEL,
					messages: [
						{ role: 'system', content: system_prompt },
						{ role: 'user', content: prompt }
					],
					max_tokens: 50
				})
			})

			if (!response.ok) {
				console.error('ZAI API error:', await response.text())
				return json({ name: generate_fallback_name(prompt) })
			}

			const data = await response.json()
			name = data.choices?.[0]?.message?.content?.trim() || generate_fallback_name(prompt)
		} else {
			// OpenAI (default)
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${LLM_API_KEY}`
				},
				body: JSON.stringify({
					model: 'gpt-4o-mini', // Use mini for speed/cost
					messages: [
						{ role: 'system', content: system_prompt },
						{ role: 'user', content: prompt }
					],
					max_tokens: 50
				})
			})

			if (!response.ok) {
				console.error('OpenAI API error:', await response.text())
				return json({ name: generate_fallback_name(prompt) })
			}

			const data = await response.json()
			name = data.choices?.[0]?.message?.content?.trim() || generate_fallback_name(prompt)
		}

		// Clean up the name (remove quotes, extra punctuation)
		name = name.replace(/^["']|["']$/g, '').trim()

		// Truncate if too long
		if (name.length > 30) {
			name = name.substring(0, 30).trim()
		}

		return json({ name })
	} catch (err: any) {
		console.error('Generate name error:', err)
		// Return fallback name on any error
		const { prompt } = await request.json().catch(() => ({ prompt: '' }))
		return json({ name: generate_fallback_name(prompt) })
	}
}

/**
 * Fallback name generation when LLM is not available
 */
function generate_fallback_name(prompt: string): string {
	// Extract first few meaningful words from prompt
	const stop_words = new Set([
		'a', 'an', 'the', 'to', 'for', 'of', 'and', 'or', 'in', 'on', 'at',
		'me', 'my', 'i', 'want', 'need', 'make', 'create', 'build', 'app',
		'application', 'that', 'which', 'with', 'can', 'will', 'please'
	])

	const words = prompt
		.toLowerCase()
		.replace(/[^\w\s]/g, '')
		.split(/\s+/)
		.filter(w => w.length > 2 && !stop_words.has(w))
		.slice(0, 3)

	if (words.length === 0) return 'New Project'

	return words
		.map(w => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ')
}
