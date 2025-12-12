import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { env } from '$env/dynamic/private'
import { getProject, updateProject, createSnapshot, getLLMSettings, validateUserToken, unauthorizedResponse, type LLMSettings } from '$lib/server/pb'
import { create_stream_response, type LLMProvider, type AgentMessage } from '$lib/ai/sdk-agent'
import { calculateCost } from '$lib/ai/types'

// Env var fallbacks
const ENV_LLM_PROVIDER = (env.LLM_PROVIDER as LLMProvider) || 'openai'
const ENV_LLM_API_KEY = env.LLM_API_KEY || ''
const ENV_LLM_MODEL = env.LLM_MODEL || 'gpt-4o'
const ENV_LLM_BASE_URL = env.LLM_BASE_URL

// Get LLM config from DB or fall back to env vars
async function getLLMConfig() {
	const dbSettings = await getLLMSettings()

	if (dbSettings && dbSettings.api_key) {
		return {
			provider: dbSettings.provider as LLMProvider,
			apiKey: dbSettings.api_key,
			model: dbSettings.model,
			baseUrl: dbSettings.base_url
		}
	}

	return {
		provider: ENV_LLM_PROVIDER,
		apiKey: ENV_LLM_API_KEY,
		model: ENV_LLM_MODEL,
		baseUrl: ENV_LLM_BASE_URL
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
	console.error('[AI Service] Error:', error)

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

// GET - Get agent history
export const GET: RequestHandler = async ({ params, request }) => {
	const user = await validateUserToken(request)
	if (!user) return unauthorizedResponse('Authentication required')

	try {
		const project = await getProject(params.id)
		if (!project) {
			return json({ error: 'Project not found' }, { status: 404 })
		}
		return json({ messages: project.agent_chat || [] })
	} catch (error: any) {
		if (error.status === 404) {
			return json({ error: 'Project not found' }, { status: 404 })
		}
		return json({ error: 'Failed to load agent history' }, { status: 500 })
	}
}

// DELETE - Clear agent history
export const DELETE: RequestHandler = async ({ params, request }) => {
	const user = await validateUserToken(request)
	if (!user) return unauthorizedResponse('Authentication required')

	try {
		await updateProject(params.id, { agent_chat: [] })
		return json({ success: true })
	} catch (error: any) {
		if (error.status === 404) {
			return json({ error: 'Project not found' }, { status: 404 })
		}
		return json({ error: 'Failed to clear agent history' }, { status: 500 })
	}
}

// POST - Send prompt to agent
export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	const user = await validateUserToken(request)
	if (!user) return unauthorizedResponse('Authentication required')

	try {
		const { prompt, messages, spec } = await request.json()

		// Extract user prompt from request
		let userPrompt = prompt
		if (!userPrompt && messages && Array.isArray(messages)) {
			const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop()
			userPrompt = lastUserMessage?.content || ''
		}

		if (!userPrompt) {
			return json({ error: 'Prompt is required' }, { status: 400 })
		}

		// Rate limit check
		const clientIp = getClientAddress()
		const rateCheck = checkRateLimit(clientIp)
		if (!rateCheck.allowed) {
			return json(
				{ error: `Rate limit exceeded. Try again in ${rateCheck.retryAfter} seconds.` },
				{ status: 429, headers: { 'Retry-After': String(rateCheck.retryAfter) } }
			)
		}

		// Get project and LLM config
		const project = await getProject(params.id)
		if (!project) {
			return json({ error: 'Project not found' }, { status: 404 })
		}

		const llmConfig = await getLLMConfig()
		if (!llmConfig.apiKey) {
			return json({ error: 'AI not configured. Add your API key in Settings.' }, { status: 500 })
		}

		// Build conversation history
		const agentMessages = project.agent_chat || []
		agentMessages.push({
			role: 'user',
			content: userPrompt,
			timestamp: Date.now()
		})

		// Convert to AgentMessage format (just role + content)
		const conversationHistory: AgentMessage[] = agentMessages
			.filter((m: any) => m.role === 'user' || m.role === 'assistant')
			.map((m: any) => ({ role: m.role, content: m.content }))

		// Create snapshot before agent makes changes
		// Truncate prompt if too long for snapshot label
		const truncatedPrompt = userPrompt.length > 60 ? userPrompt.slice(0, 60) + '...' : userPrompt
		await createSnapshot(params.id, `Before: ${truncatedPrompt}`)

		// Create streaming response
		const encoder = new TextEncoder()
		let fullResponse = ''
		const toolCalls: Array<{ name: string; args?: Record<string, any>; result?: string }> = []

		const stream = new ReadableStream({
			async start(controller) {
				try {
					const { run_agent } = await import('$lib/ai/sdk-agent')

					const result = await run_agent(llmConfig, params.id, conversationHistory, spec, {
						onText: (text) => {
							fullResponse += text
							controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: text })}\n\n`))
						},
						onToolCallStart: (name) => {
							// Tool is starting to generate - show loading state immediately
							controller.enqueue(encoder.encode(`data: ${JSON.stringify({
								toolCallStart: { name },
								incremental: true
							})}\n\n`))
						},
						onToolCall: (name, args) => {
							// Track tool call (result will be added when onToolResult fires)
							toolCalls.push({ name, args })
							controller.enqueue(encoder.encode(`data: ${JSON.stringify({
								toolCall: { name, parameters: args },
								incremental: true
							})}\n\n`))
						},
						onToolResult: (name, result) => {
							console.log('[Server] onToolResult called:', name, result?.slice?.(0, 100) || result)
							// Find and update the matching tool call with its result
							const call = toolCalls.find(c => c.name === name && !c.result)
							if (call) call.result = result

							controller.enqueue(encoder.encode(`data: ${JSON.stringify({
								toolResult: result,
								toolCall: { name, parameters: call?.args },
								incremental: true
							})}\n\n`))
						},
						onError: (error) => {
							controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`))
						}
					})

					// Save assistant response with structured tool_calls
					agentMessages.push({
						role: 'assistant',
						content: fullResponse,
						tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
						timestamp: Date.now()
					})
					await updateProject(params.id, { agent_chat: agentMessages })

					// Create snapshot after agent makes changes
					await createSnapshot(params.id, `After: ${truncatedPrompt}`)

					// Send usage with cost
					const cost = calculateCost(llmConfig.model, {
						promptTokens: result.usage.promptTokens,
						completionTokens: result.usage.completionTokens,
						totalTokens: result.usage.promptTokens + result.usage.completionTokens
					}, llmConfig.provider)

					controller.enqueue(encoder.encode(`data: ${JSON.stringify({
						done: true,
						usage: {
							promptTokens: result.usage.promptTokens,
							completionTokens: result.usage.completionTokens,
							totalTokens: result.usage.promptTokens + result.usage.completionTokens,
							model: llmConfig.model,
							cost
						}
					})}\n\n`))
				} catch (error: any) {
					const formattedError = formatError(error)
					controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: formattedError })}\n\n`))
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
	} catch (error: any) {
		if (error.status === 404) {
			return json({ error: 'Project not found' }, { status: 404 })
		}
		const formattedError = formatError(error)
		return json({ error: formattedError }, { status: 500 })
	}
}
