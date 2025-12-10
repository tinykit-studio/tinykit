import { json } from '@sveltejs/kit'
import { createLLMProvider } from '$lib/ai'
import { Agent } from '$lib/ai/agent'
import type { RequestHandler } from './$types'
import { env } from '$env/dynamic/private'
import { getProject, updateProject, createSnapshot, getLLMSettings, validateUserToken, unauthorizedResponse, type LLMSettings } from '$lib/server/pb'
import { calculateCost } from '$lib/ai/types'

// Env var fallbacks
const ENV_LLM_PROVIDER = (env.LLM_PROVIDER as LLMSettings['provider']) || 'openai'
const ENV_LLM_API_KEY = env.LLM_API_KEY || ''
const ENV_LLM_MODEL = env.LLM_MODEL || 'gpt-4'
const ENV_LLM_BASE_URL = env.LLM_BASE_URL

// Get LLM config from DB or fall back to env vars
async function getLLMConfig(): Promise<{ provider: LLMSettings['provider']; apiKey: string; model: string; baseUrl?: string }> {
	const dbSettings = await getLLMSettings()

	if (dbSettings && dbSettings.api_key) {
		return {
			provider: dbSettings.provider,
			apiKey: dbSettings.api_key,
			model: dbSettings.model,
			baseUrl: dbSettings.base_url
		}
	}

	// Fall back to env vars
	return {
		provider: ENV_LLM_PROVIDER,
		apiKey: ENV_LLM_API_KEY,
		model: ENV_LLM_MODEL,
		baseUrl: ENV_LLM_BASE_URL
	}
}

// Tools that modify project state and warrant a snapshot
const STATE_MODIFYING_TOOLS = new Set([
	'write_code',
	'create_content_field',
	'create_design_field',
	'create_data_file',
	'insert_records',
	'update_config_field',
	'update_spec'
])

function hasStateModifyingTools(toolCalls: Array<{ name: string }>): boolean {
	return toolCalls.some(call => STATE_MODIFYING_TOOLS.has(call.name))
}

// Simple in-memory rate limiting (requests per minute)
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
		const retryAfter = Math.ceil((record.resetTime - now) / 1000)
		return { allowed: false, retryAfter }
	}

	record.count++
	return { allowed: true }
}

function extractFieldNameFromParams(toolName: string, paramsJson: string): string | null {
	try {
		const params = JSON.parse(paramsJson)
		if (toolName === 'create_content_field' || toolName === 'create_design_field') {
			return params.name || null
		}
		if (toolName === 'create_data_file') {
			return params.filename || null
		}
	} catch {
		// Invalid JSON, ignore
	}
	return null
}

function stripToolCalls(text: string): string {
	let cleaned = text

	cleaned = cleaned.replace(/```(\w+):([^\n]+)\n[\s\S]*?```/g, () => {
		return `~~~code~~~`
	})

	cleaned = cleaned.replace(/<tool>[\s\S]*?<\/tool>/g, (match) => {
		const nameMatch = match.match(/<name>(\w+)<\/name>/)
		const toolName = nameMatch ? nameMatch[1] : 'unknown'

		const paramsMatch = match.match(/<parameters>([\s\S]*?)<\/parameters>/)
		let fieldName: string | null = null
		if (paramsMatch) {
			fieldName = extractFieldNameFromParams(toolName, paramsMatch[1].trim())
		}

		const suffix = fieldName ? `:${fieldName}` : ''
		return `\n\n~~~tool:${toolName}${suffix}~~~`
	})

	if (cleaned.includes('<tool>')) {
		cleaned = cleaned.substring(0, cleaned.indexOf('<tool>')).trim()
	}

	cleaned = cleaned.replace(/\n{3,}/g, '\n\n')

	return cleaned
}

// Strip tool markers from content before sending to LLM
// This prevents the LLM from seeing and mimicking the ~~~tool:...~~~ format
function stripToolMarkersForLLM(content: string): string {
	// Remove ~~~tool:toolname:fieldname~~~ and ~~~tool:toolname~~~ markers
	// Keep surrounding text intact
	return content
		.replace(/\n*~~~tool:\w+(?::[^~]+)?~~~\n*/g, '\n')
		.replace(/\n*~~~code~~~\n*/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

async function createAgent(project: any, projectId: string): Promise<{ agent: Agent; model: string }> {
	const llmConfig = await getLLMConfig()

	if (!llmConfig.apiKey) {
		throw new Error(
			'AI agent not configured. Please add your API key in Settings, or set LLM_API_KEY environment variable.'
		)
	}

	const provider = createLLMProvider({
		provider: llmConfig.provider,
		apiKey: llmConfig.apiKey,
		model: llmConfig.model,
		baseUrl: llmConfig.baseUrl,
		webSearch: true
	})

	const agent = new Agent(provider, projectId)

	// Load conversation history from project.agent_chat array
	// Strip tool markers so LLM doesn't see/mimic the ~~~tool~~~ format
	const agentMessages = project.agent_chat || []
	for (const msg of agentMessages) {
		if (msg.role !== 'system') {
			agent.getHistory().push({
				role: msg.role,
				content: msg.role === 'assistant'
					? stripToolMarkersForLLM(msg.content)
					: msg.content
			})
		}
	}

	return { agent, model: llmConfig.model }
}

function formatError(error: any): string {
	const errorStr = String(error)

	console.error('[AI Service] Full error:', error)

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

// GET /api/projects/:id/agent - Get agent history
export const GET: RequestHandler = async ({ params, request }) => {
	// Require authentication
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	try {
		const project = await getProject(params.id)
		const messages = project.agent_chat || []
		return json({ messages })
	} catch (error: any) {
		if (error.status === 404) {
			return json({ error: 'Project not found' }, { status: 404 })
		}
		console.error('Failed to load agent history:', error)
		return json({ error: 'Failed to load agent history' }, { status: 500 })
	}
}

// DELETE /api/projects/:id/agent - Clear agent history
export const DELETE: RequestHandler = async ({ params, request }) => {
	// Require authentication
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	try {
		await updateProject(params.id, { agent_chat: [] })
		return json({ success: true })
	} catch (error: any) {
		if (error.status === 404) {
			return json({ error: 'Project not found' }, { status: 404 })
		}
		console.error('Failed to clear agent history:', error)
		return json({ error: 'Failed to clear agent history' }, { status: 500 })
	}
}

// POST /api/projects/:id/agent - Send prompt
export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	// Require authentication
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	try {
		const { prompt, messages, stream, spec } = await request.json()

		let userPrompt = prompt
		if (!userPrompt && messages && Array.isArray(messages)) {
			const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop()
			userPrompt = lastUserMessage?.content || ''
		}

		if (!userPrompt) {
			return json({ error: 'Prompt or messages is required' }, { status: 400 })
		}

		// Check rate limit
		const clientIp = getClientAddress()
		const rateCheck = checkRateLimit(clientIp)
		if (!rateCheck.allowed) {
			return json(
				{ error: `Rate limit exceeded. Please try again in ${rateCheck.retryAfter} seconds.` },
				{
					status: 429,
					headers: { 'Retry-After': String(rateCheck.retryAfter) }
				}
			)
		}

		const project = await getProject(params.id)
		if (!project) {
			return json({ error: 'Project not found' }, { status: 404 })
		}
		const { agent, model: activeModel } = await createAgent(project, params.id)
		const llmConfig = await getLLMConfig()

		if (stream) {
			const encoder = new TextEncoder()
			const readable = new ReadableStream({
				async start(controller) {
					try {
						const agentMessages = project.agent_chat || []
						agentMessages.push({
							role: 'user',
							content: userPrompt,
							timestamp: Date.now()
						})

						let assistantResponse = ''
						let processedToolIndices = new Set<number>()
						let snapshotCreated = false

						for await (const chunk of agent.streamPrompt(userPrompt, spec)) {
							if (chunk.content) {
								assistantResponse += chunk.content
								controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: chunk.content })}\n\n`))
							}
							if (chunk.usage) {
								const cost = calculateCost(activeModel, chunk.usage, llmConfig.provider)
								controller.enqueue(encoder.encode(`data: ${JSON.stringify({
									done: true,
									usage: { ...chunk.usage, model: activeModel, cost }
								})}\n\n`))
							}

							const toolCalls = agent.extractToolCalls(assistantResponse)

							for (let i = 0; i < toolCalls.length; i++) {
								if (!processedToolIndices.has(i)) {
									processedToolIndices.add(i)
									const toolCall = toolCalls[i]

									try {
										// Create a single snapshot before the first state-modifying tool
										if (!snapshotCreated && STATE_MODIFYING_TOOLS.has(toolCall.name)) {
											await createSnapshot(params.id, 'Before agent changes')
											snapshotCreated = true
										}

										const toolResults = await agent.executeToolCalls([toolCall])
										controller.enqueue(
											encoder.encode(
												`data: ${JSON.stringify({
													toolCall,
													toolResult: toolResults[0],
													incremental: true
												})}\n\n`
											)
										)
									} catch (error) {
										console.error('Error executing tool during stream:', error)
									}
								}
							}
						}

						const cleanedResponse = stripToolCalls(assistantResponse)

						agentMessages.push({
							role: 'assistant',
							content: cleanedResponse,
							timestamp: Date.now()
						})

						await updateProject(params.id, { agent_chat: agentMessages })

						// Note: Code blocks (```svelte:App.svelte) were applied by the client
						// during streaming. The write_code tool also writes code directly.
						// We don't call applyCodeBlocks here to avoid double-writing.
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))

						controller.close()
					} catch (error) {
						const formattedError = formatError(error)
						controller.enqueue(
							encoder.encode(`data: ${JSON.stringify({ error: formattedError })}\n\n`)
						)
						controller.close()
					}
				}
			})

			return new Response(readable, {
				headers: {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					Connection: 'keep-alive'
				}
			})
		} else {
			const agentMessages = project.agent_chat || []

			agentMessages.push({
				role: 'user',
				content: userPrompt,
				timestamp: Date.now()
			})

			const result = await agent.processPrompt(userPrompt)

			const cleanedResponse = stripToolCalls(result.response)

			agentMessages.push({
				role: 'assistant',
				content: cleanedResponse,
				timestamp: Date.now()
			})

			await updateProject(params.id, { agent_chat: agentMessages })

			const toolCalls = agent.extractToolCalls(result.response)
			let toolResults: string[] = []
			if (toolCalls.length > 0) {
				// Create a single snapshot before executing any state-modifying tools
				if (hasStateModifyingTools(toolCalls)) {
					await createSnapshot(params.id, 'Before agent changes')
				}
				toolResults = await agent.executeToolCalls(toolCalls)
			}

			if (result.codeBlocks.length > 0) {
				await agent.applyCodeBlocks(result.codeBlocks)
			}

			return json({
				response: result.response,
				codeBlocks: result.codeBlocks,
				toolCalls,
				toolResults
			})
		}
	} catch (error: any) {
		if (error.status === 404) {
			return json({ error: 'Project not found' }, { status: 404 })
		}
		console.error('Agent error:', error)
		const formattedError = formatError(error)
		return json({ error: formattedError }, { status: 500 })
	}
}
