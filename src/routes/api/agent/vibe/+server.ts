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

// Simple in-memory rate limiting
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT = 100
const RATE_LIMIT_WINDOW = 60 * 1000

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
	const now = Date.now()
	const record = rateLimitMap.get(ip)

	if (!record || now > record.resetTime) {
		rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW })
		return { allowed: true }
	}

	if (record.count >= RATE_LIMIT) {
		return { allowed: false, retryAfter: Math.ceil((record.resetTime - now) / 1000) }
	}

	record.count++
	return { allowed: true }
}

function formatError(error: any): string {
	const errorStr = String(error)
	console.error('[Vibe Lounge] Error:', error)

	if (errorStr.includes('429') || errorStr.includes('rate_limit')) {
		return 'AI service rate limit reached. Please wait a moment and try again.'
	}
	if (errorStr.includes('401') || errorStr.includes('invalid_api_key')) {
		return 'AI service authentication failed. Please check your API key configuration.'
	}
	if (errorStr.includes('ECONNREFUSED') || errorStr.includes('ETIMEDOUT')) {
		return 'Could not connect to AI service. Please check your network connection.'
	}
	return `AI service error: ${errorStr.slice(0, 200)}`
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	try {
		const { prompt } = await request.json()

		if (!prompt) {
			return json({ error: 'Prompt is required' }, { status: 400 })
		}

		const clientIp = getClientAddress()
		const rateCheck = checkRateLimit(clientIp)
		if (!rateCheck.allowed) {
			return json(
				{ error: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.` },
				{ status: 429, headers: { 'Retry-After': String(rateCheck.retryAfter) } }
			)
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
			prompt
		})

		return json({ response: result.text })
	} catch (error) {
		console.error('Vibe lounge error:', error)
		return json({ error: formatError(error) }, { status: 500 })
	}
}
