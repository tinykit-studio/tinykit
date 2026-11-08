import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { is_configured } from '$lib/ai/config'
import { get_summary_model } from '$lib/ai/model'
import { getProject, updateProject, createSnapshot, getLLMSettings, validateUserToken, unauthorizedResponse } from '$lib/server/pb'
import { type LLMProvider, type AgentMessage } from '$lib/ai/sdk-agent'
import { calculateCost } from '$lib/ai/types'

// Track running agents to prevent duplicate runs
const runningAgents = new Map<string, boolean>()

// getLLMSettings applies environment overrides before saved settings.
async function getLLMConfig() {
	const settings = await getLLMSettings()
	if (!is_configured(settings) || !settings) return null
	return { provider: settings.provider, apiKey: settings.api_key, model: settings.model, baseUrl: settings.base_url }
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

// Generate a one-line summary of what the agent did
async function generateSummary(
	llmConfig: { provider: LLMProvider; apiKey: string; model: string; baseUrl?: string },
	agentResponse: string,
	toolCalls: Array<{ name: string; args?: Record<string, any> }>
): Promise<string> {
	try {
		const { generateText } = await import('ai')

		// Build context about what happened
		const toolSummary = toolCalls.length > 0
			? `Tools used: ${toolCalls.map(t => t.name).join(', ')}`
			: 'No tools used'

		const prompt = `Summarize what was done in ONE short sentence (max 60 chars). Be specific about the change, not generic.

Agent response: ${agentResponse.slice(0, 500)}
${toolSummary}

Examples of good summaries:
- "Added login form with email/password"
- "Fixed button hover color"
- "Created products data table"
- "Updated header text to 'Welcome'"

One-line summary:`

		const model = get_summary_model(llmConfig)

		const result = await generateText({
			model,
			prompt
		})

		const summary = result.text.trim().replace(/^["']|["']$/g, '').slice(0, 80)
		return summary || 'Made changes'
	} catch (error) {
		console.error('[Summary] Failed to generate:', error)
		return 'Made changes'
	}
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

// POST - Send prompt to agent (fire-and-forget, streams to database)
export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	const user = await validateUserToken(request)
	if (!user) return unauthorizedResponse('Authentication required')

	const projectId = params.id

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

		// Check if agent is already running for this project
		if (runningAgents.get(projectId)) {
			return json({ error: 'Agent is already processing a request' }, { status: 409 })
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
		const project = await getProject(projectId)
		if (!project) {
			return json({ error: 'Project not found' }, { status: 404 })
		}

		const llmConfig = await getLLMConfig()
		if (!llmConfig) {
			return json({ error: 'AI not configured. Choose a provider and model in Settings.' }, { status: 500 })
		}

		// Build conversation history (should include initial user message)
		const agentMessages = project.agent_chat || []

		// Add the new user message to the conversation
		agentMessages.push({
			role: 'user',
			content: userPrompt,
			timestamp: Date.now()
		})

		// Add placeholder assistant message (will be updated as chunks arrive)
		const assistantMsgIndex = agentMessages.length
		agentMessages.push({
			role: 'assistant',
			content: '',
			stream_items: [],
			status: 'running',
			timestamp: Date.now()
		})

		// Save initial state with user message and running assistant
		await updateProject(projectId, {
			agent_chat: agentMessages,
			agent_status: 'running'
		})

		// Mark agent as running
		runningAgents.set(projectId, true)

		// Convert to AgentMessage format for LLM
		const conversationHistory: AgentMessage[] = agentMessages
			.filter((m: any) => m.role === 'user' || (m.role === 'assistant' && m.content))
			.map((m: any) => ({ role: m.role, content: m.content }))

		// Fire-and-forget: run agent in background
		runAgentInBackground(projectId, llmConfig, agentMessages, assistantMsgIndex, conversationHistory, spec)

		// Return immediately
		return json({ started: true, status: 'running' })

	} catch (error: any) {
		runningAgents.delete(projectId)
		if (error.status === 404) {
			return json({ error: 'Project not found' }, { status: 404 })
		}
		const formattedError = formatError(error)
		return json({ error: formattedError }, { status: 500 })
	}
}

// Background agent execution - updates database as it runs
async function runAgentInBackground(
	projectId: string,
	llmConfig: { provider: LLMProvider; apiKey: string; model: string; baseUrl?: string },
	agentMessages: any[],
	assistantMsgIndex: number,
	conversationHistory: AgentMessage[],
	spec: string
) {
	let fullResponse = ''
	const toolCalls: Array<{ id: string; name: string; args?: Record<string, any>; result?: string }> = []
	const streamItems: Array<{ type: 'text' | 'tool'; content?: string; id?: string; name?: string; args?: Record<string, any>; result?: string }> = []

	// Throttle DB updates to avoid hammering Pocketbase
	let lastDbUpdate = 0
	const DB_UPDATE_INTERVAL = 500 // ms
	let pendingDbUpdate = false

	async function updateDb(force = false) {
		const now = Date.now()
		if (!force && now - lastDbUpdate < DB_UPDATE_INTERVAL) {
			// Schedule a pending update if not already scheduled
			if (!pendingDbUpdate) {
				pendingDbUpdate = true
				setTimeout(() => {
					pendingDbUpdate = false
					updateDb(true)
				}, DB_UPDATE_INTERVAL - (now - lastDbUpdate))
			}
			return
		}
		lastDbUpdate = now

		// Update assistant message in place
		agentMessages[assistantMsgIndex] = {
			...agentMessages[assistantMsgIndex],
			content: fullResponse,
			stream_items: [...streamItems],
			tool_calls: toolCalls.length > 0 ? [...toolCalls] : undefined
		}

		try {
			await updateProject(projectId, { agent_chat: agentMessages })
		} catch (err) {
			console.error('[Agent] Failed to update DB:', err)
		}
	}

	try {
		const { run_agent } = await import('$lib/ai/sdk-agent')

		const result = await run_agent(llmConfig, projectId, conversationHistory, spec, {
			onText: (text) => {
				fullResponse += text
				// Add to stream_items (append to last text item if exists)
				const lastItem = streamItems[streamItems.length - 1]
				if (lastItem && lastItem.type === 'text') {
					lastItem.content = (lastItem.content || '') + text
				} else {
					streamItems.push({ type: 'text', content: text })
				}
				updateDb()
			},
			onToolCallStart: (id, name) => {
				// Add pending tool to stream_items if not already present
				const existing = streamItems.find(s => s.id === id)
				if (!existing) {
					streamItems.push({ type: 'tool', id, name, result: undefined })
					updateDb()
				}
			},
			onToolCall: (id, name, args) => {
				// Check if tool call already exists (might not if we missed start)
				const existingCall = toolCalls.find(c => c.id === id)
				if (!existingCall) {
					toolCalls.push({ id, name, args })
				} else {
					existingCall.args = args
				}

				// Update the pending tool item with args
				const pendingTool = streamItems.find(s => s.id === id)
				if (pendingTool) pendingTool.args = args
				else streamItems.push({ type: 'tool', id, name, args, result: undefined })

				updateDb()
			},
			onToolResult: (id, name, resultStr) => {
				const call = toolCalls.find(c => c.id === id)
				if (call) call.result = resultStr
				// Update the tool item with result
				const toolItem = streamItems.find(s => s.id === id)
				if (toolItem) toolItem.result = resultStr
				updateDb(true) // Force update on tool result
			},
			onError: (error) => {
				console.error('[Agent Error]', error)
			}
		})

		// Calculate cost
		const cost = calculateCost(llmConfig.model, {
			promptTokens: result.usage.promptTokens,
			completionTokens: result.usage.completionTokens,
			totalTokens: result.usage.promptTokens + result.usage.completionTokens
		}, llmConfig.provider)

		// Final update with completed status
		agentMessages[assistantMsgIndex] = {
			role: 'assistant',
			content: fullResponse,
			stream_items: streamItems,
			tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
			usage: {
				promptTokens: result.usage.promptTokens,
				completionTokens: result.usage.completionTokens,
				totalTokens: result.usage.promptTokens + result.usage.completionTokens,
				model: llmConfig.model,
				cost
			},
			status: 'complete',
			timestamp: Date.now()
		}

		await updateProject(projectId, {
			agent_chat: agentMessages,
			agent_status: 'idle'
		})

		// Generate summary and create snapshot with tool names
		const summary = await generateSummary(llmConfig, fullResponse, toolCalls)
		const toolNames = toolCalls.map(t => t.name)
		await createSnapshot(projectId, summary, toolNames)

	} catch (error: any) {
		console.error('[Agent] Background execution failed:', error)
		const formattedError = formatError(error)

		// Update with error status
		agentMessages[assistantMsgIndex] = {
			...agentMessages[assistantMsgIndex],
			content: fullResponse || `Error: ${formattedError}`,
			status: 'error',
			error: formattedError,
			timestamp: Date.now()
		}

		await updateProject(projectId, {
			agent_chat: agentMessages,
			agent_status: 'error'
		}).catch(console.error)

	} finally {
		runningAgents.delete(projectId)
	}
}
