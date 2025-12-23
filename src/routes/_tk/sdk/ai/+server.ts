import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { streamText, generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { pb } from '$lib/server/pb'

/**
 * Backend SDK: AI
 *
 * POST /_tk/sdk/ai - Generate text with configured LLM
 *
 * Request: { prompt, system?, stream? }
 * Response: { text } or SSE stream
 */

type LLMSettings = {
	provider: 'openai' | 'anthropic' | 'gemini'
	api_key: string
	model: string
	base_url?: string
}

async function get_llm_settings(): Promise<LLMSettings | null> {
	try {
		const record = await pb.collection('_tk_settings').getOne('llm')
		return record.value as LLMSettings
	} catch {
		return null
	}
}

function get_model(settings: LLMSettings) {
	switch (settings.provider) {
		case 'openai': {
			const openai = createOpenAI({
				apiKey: settings.api_key,
				baseURL: settings.base_url
			})
			return openai(settings.model)
		}
		case 'anthropic': {
			const anthropic = createAnthropic({ apiKey: settings.api_key })
			return anthropic(settings.model)
		}
		case 'gemini': {
			const google = createGoogleGenerativeAI({ apiKey: settings.api_key })
			return google(settings.model)
		}
		default:
			throw new Error(`Unknown provider: ${settings.provider}`)
	}
}

// Non-streaming response
export const POST: RequestHandler = async ({ request }) => {
	const settings = await get_llm_settings()
	if (!settings) {
		throw error(503, 'AI not configured. Set up LLM in Settings.')
	}

	let body: { prompt: string; system?: string; stream?: boolean }
	try {
		body = await request.json()
	} catch {
		throw error(400, 'Invalid JSON body')
	}

	if (!body.prompt) {
		throw error(400, 'Missing prompt')
	}

	const model = get_model(settings)

	// Streaming response
	if (body.stream) {
		const result = streamText({
			model,
			system: body.system,
			prompt: body.prompt
		})

		const encoder = new TextEncoder()
		const stream = new ReadableStream({
			async start(controller) {
				try {
					for await (const chunk of result.textStream) {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
					}
					controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
				} catch (err: any) {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`))
				} finally {
					controller.close()
				}
			}
		})

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive'
			}
		})
	}

	// Non-streaming response
	try {
		const result = await generateText({
			model,
			system: body.system,
			prompt: body.prompt
		})

		return json({ text: result.text })
	} catch (err: any) {
		console.error('[SDK/AI] Error:', err)
		throw error(500, err.message || 'AI request failed')
	}
}
