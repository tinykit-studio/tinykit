import { json } from '@sveltejs/kit'
import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { RequestHandler } from './$types'
import { env } from '$env/dynamic/private'
import { validateUserToken, unauthorizedResponse } from '$lib/server/pb'

const LLM_PROVIDER = (env.LLM_PROVIDER as 'openai' | 'anthropic' | 'gemini' | 'deepseek') || 'openai'
const LLM_API_KEY = env.LLM_API_KEY || ''
const LLM_MODEL = env.LLM_MODEL || 'gpt-4'
const LLM_BASE_URL = env.LLM_BASE_URL

function get_model(provider: string, apiKey: string, model: string, baseUrl?: string) {
	switch (provider) {
		case 'openai':
		case 'deepseek': {
			const openai = createOpenAI({
				apiKey,
				baseURL: baseUrl || (provider === 'deepseek' ? 'https://api.deepseek.com/v1' : undefined)
			})
			return openai(model)
		}
		case 'anthropic': {
			const anthropic = createAnthropic({ apiKey })
			return anthropic(model)
		}
		case 'gemini': {
			const google = createGoogleGenerativeAI({ apiKey })
			return google(model)
		}
		default:
			throw new Error(`Unknown provider: ${provider}`)
	}
}

const THEME_SYSTEM_PROMPT = `You are a theme generation expert. Generate a complete design system theme based on the user's description.

Return ONLY a valid JSON object with this exact structure (no other text):
{
  "name": "Theme Name",
  "description": "Brief description of the theme",
  "fields": [
    { "name": "Primary Color", "css_var": "--color-primary", "value": "#hex", "description": "Main brand color" },
    { "name": "Secondary Color", "css_var": "--color-secondary", "value": "#hex", "description": "Supporting brand color" },
    { "name": "Accent Color", "css_var": "--color-accent", "value": "#hex", "description": "Highlight color" },
    { "name": "Background", "css_var": "--color-bg", "value": "#hex", "description": "Main background" },
    { "name": "Surface", "css_var": "--color-surface", "value": "#hex", "description": "Card/panel background" },
    { "name": "Text", "css_var": "--color-text", "value": "#hex", "description": "Primary text" },
    { "name": "Text Muted", "css_var": "--color-text-muted", "value": "#hex", "description": "Secondary text" },
    { "name": "Border", "css_var": "--color-border", "value": "#hex", "description": "Border color" },
    { "name": "Font Family", "css_var": "--font-family", "value": "font-stack", "description": "Main font" },
    { "name": "Border Radius", "css_var": "--radius", "value": "0.5rem", "description": "Corner roundness" },
    { "name": "Spacing Unit", "css_var": "--spacing", "value": "1rem", "description": "Base spacing" }
  ]
}

Rules:
- Always use hex colors (#rrggbb format)
- Ensure good contrast between text and backgrounds
- Keep font families web-safe or system fonts
- Use rem units for spacing and border radius
- Make colors harmonious and accessible`

export const POST: RequestHandler = async ({ request }) => {
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	try {
		const { prompt } = await request.json()

		if (!prompt || typeof prompt !== 'string') {
			return json({ error: 'Prompt is required' }, { status: 400 })
		}

		if (!LLM_API_KEY) {
			return json(
				{ error: 'AI service not configured. Please set LLM_API_KEY environment variable.' },
				{ status: 500 }
			)
		}

		const model = get_model(LLM_PROVIDER, LLM_API_KEY, LLM_MODEL, LLM_BASE_URL)
		const result = await generateText({
			model,
			system: THEME_SYSTEM_PROMPT,
			prompt: `Generate a theme: ${prompt}`
		})

		// Parse the JSON response
		let theme_data
		try {
			const json_match = result.text.match(/```json\n([\s\S]*?)\n```/) ||
			                   result.text.match(/```\n([\s\S]*?)\n```/)
			const json_str = json_match ? json_match[1] : result.text
			theme_data = JSON.parse(json_str.trim())
		} catch {
			console.error('Failed to parse AI response:', result.text)
			throw new Error('AI generated invalid theme format')
		}

		if (!theme_data.fields || !Array.isArray(theme_data.fields)) {
			throw new Error('Invalid theme structure')
		}

		return json(theme_data)
	} catch (err) {
		console.error('Theme generation error:', err)
		return json(
			{ error: err instanceof Error ? err.message : 'Failed to generate theme' },
			{ status: 500 }
		)
	}
}
