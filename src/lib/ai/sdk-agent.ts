import { streamText, tool, type CoreMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import { getProject, updateProject } from '$lib/server/pb'

export type LLMProvider = 'openai' | 'anthropic' | 'gemini' | 'deepseek'

export interface AgentConfig {
	provider: LLMProvider
	apiKey: string
	model: string
	baseUrl?: string
}

export interface AgentMessage {
	role: 'user' | 'assistant'
	content: string
}

export interface StreamCallbacks {
	onText?: (text: string) => void
	onToolCallStart?: (toolName: string) => void
	onToolCall?: (toolName: string, args: Record<string, any>) => void
	onToolResult?: (toolName: string, result: string) => void
	onError?: (error: Error) => void
}

const SYSTEM_PROMPT = `You are a code assistant for tinykit, building small web apps.

BEGIN EVERY RESPONSE WITH TEXT - NEVER WITH A TOOL CALL.

Format:
1. First sentence: Explain what you'll build (e.g., "I'll create a todo list with filtering and deletion.")
2. Then use tools
3. Done! No need to explain usage after - the tool badges show what was created.

Wrong: Immediately calling write_code ❌
Right: "I'll build X with Y features" → use tools ✅

## Architecture
- Single Svelte 5 file (App.svelte) with standard CSS in <style>
- NO Tailwind/utility classes - use semantic class names (.card, .button)
- Data via \`import data from '$data'\` with realtime subscriptions
- Content via \`import content from '$content'\` for editable text
- Design via CSS variables (--kebab-case) with fallbacks
- External data via \`import { proxy } from '$tinykit'\` for fetching external APIs/RSS/audio

## Svelte 5 Runes (REQUIRED - Svelte 4 syntax will break)
\`\`\`javascript
let count = $state(0)                                      // reactive state
let doubled = $derived(count * 2)                          // simple expressions ONLY
let filtered = $derived.by(() => items.filter(x => x.done)) // use .by() for callbacks/filters
$effect(() => { /* side effects, return cleanup fn */ })
\`\`\`

Events: \`onclick={fn}\` (not on:click). No pipe modifiers - call e.preventDefault() in handler.
Bindings: \`bind:value\` works in Svelte 5.

## Icons
\`\`\`svelte
import Icon from '@iconify/svelte'
<Icon icon="lucide:search" width={18} />
\`\`\`
Common icons: plus, x, edit, trash-2, search, settings, user, home, heart, star, bookmark, check, menu, chevron-down, arrow-left, loader-2, grid, list, eye, filter. Format: \`lucide:icon-name\`

## Data API (Persistent Database)
\`\`\`javascript
import data from '$data'

// All data persists to the database - survives page refreshes and server restarts
// Subscribe for realtime updates (returns unsubscribe fn)
$effect(() => data.todos.subscribe(items => { todos = items; loading = false }))

// CRUD operations - changes save to database, realtime auto-updates UI
await data.todos.create({ title: 'New' })
await data.todos.update(id, { done: true })
await data.todos.delete(id)
\`\`\`

**When to use:** ANY app data that needs to persist (todos, users, posts, notes, bookmarks, settings, etc.)

## Proxy API (for external data)
\`\`\`javascript
import { proxy } from '$tinykit'

// Fetch JSON from external API
const data = await proxy.json('https://api.example.com/data')

// Fetch text (RSS, HTML, XML)
const rss = await proxy.text('https://hnrss.org/frontpage')

// URL for media src attributes (audio, img)
<audio src={proxy.url('https://example.com/podcast.mp3')} />
\`\`\`

## Responsive Layout
- Mobile-first: base styles for small screens, media queries for larger
- Use relative units (%, rem, fr) not fixed px widths
- Touch-friendly: buttons/links min 44px tap target

## Workflow
1. ALWAYS start with a brief plan (2-4 lines of text explanation)
2. Use write_code tool to save App.svelte
3. IMMEDIATELY after write_code, create design fields for colors/fonts/radii and content fields for text

## Design Fields
Use CSS vars with fallbacks in code, then create fields:
\`\`\`css
.card { background: var(--card-background, #ffffff); }
\`\`\`
Types: color, font, radius, shadow, size, text. Name descriptively (not "Primary" or "Surface").

## Content Fields
Reference in code, then create:
\`\`\`svelte
<h1>{content.hero_title}</h1>
\`\`\`
Extract ALL text: titles, buttons, placeholders, empty states, messages.

## Common Mistakes (AVOID)
- \`$derived(items.filter(...))\` → use \`$derived.by(() => items.filter(...))\` for callbacks
- \`result.sort()\` in $derived → use \`[...result].sort()\` (sort mutates, copy first)
- Missing return in $effect → \`$effect(() => { return data.x.subscribe(...) })\` for cleanup
- \`on:click\` → use \`onclick\` (Svelte 5)
- \`export let x\` → use \`let { x } = $props()\` (Svelte 5)
- No loading state → always \`let loading = $state(true)\`, set false in subscribe callback

## UX Polish
- Use \`transition:fade={{ duration: 100 }}\` for dialogs and list items
- Import: \`import { fade } from 'svelte/transition'\``

function get_model(config: AgentConfig) {
	switch (config.provider) {
		case 'openai':
		case 'deepseek': {
			const openai = createOpenAI({
				apiKey: config.apiKey,
				baseURL: config.baseUrl || (config.provider === 'deepseek' ? 'https://api.deepseek.com/v1' : undefined),
				compatibility: 'strict'
			})
			return openai(config.model)
		}
		case 'anthropic': {
			const anthropic = createAnthropic({ apiKey: config.apiKey })
			return anthropic(config.model)
		}
		case 'gemini': {
			const google = createGoogleGenerativeAI({ apiKey: config.apiKey })
			return google(config.model)
		}
		default:
			throw new Error(`Unknown provider: ${config.provider}`)
	}
}

function create_tools(project_id: string) {
	return {
		write_code: tool({
			description: 'Write code to App.svelte. Use this to create or update the application code.',
			inputSchema: z.object({
				code: z.string().describe('The complete Svelte 5 component code to write to App.svelte')
			}),
			execute: async ({ code }: { code: string }) => {
				// Note: onToolCall is triggered by stream events, not here (avoids duplicates)
				await updateProject(project_id, { frontend_code: code })
				return `Wrote code to App.svelte (${code.length} chars)`
			}
		}),

		create_content_field: tool({
			description: 'Create a CMS-like content field that can be edited without code changes. Content fields are automatically available in the app via: import content from \'$content\'. Field names are slugified (e.g., "Hero Title" becomes content.hero_title).',
			inputSchema: z.object({
				name: z.string().describe('Field name (e.g., "Hero Title", "App Name")'),
				type: z.enum(['text', 'textarea', 'number', 'boolean', 'json']).describe('Field type'),
				value: z.string().describe('Initial value for the field'),
				description: z.string().optional().describe('Optional description of what this field is for')
			}),
			execute: async ({ name, type, value, description }: { name: string; type: string; value: string; description?: string }) => {
				const project = await getProject(project_id)
				if (!project) throw new Error('Project not found')
				const fields = project.content || []

				// Check for duplicates
				if (fields.find((f: any) => f.name === name)) {
					return `Content field "${name}" already exists`
				}

				fields.push({
					id: Date.now().toString(),
					name,
					type,
					value: type === 'boolean' ? value === 'true' : value,
					description: description || ''
				})
				await updateProject(project_id, { content: fields })
				return `Created content field "${name}" (${type}) with value: ${value}`
			}
		}),

		create_design_field: tool({
			description: `Create a design field (CSS variable) for styling the app. Design fields appear in the Design tab with specialized editors based on type.

Field types: color, size, font, radius, shadow, text
CSS variable is auto-generated from name: "Card Background" → --card-background`,
			inputSchema: z.object({
				name: z.string().describe('Human-readable field name (e.g., "Page Background", "Card Border Color")'),
				type: z.enum(['color', 'size', 'font', 'radius', 'shadow', 'text']).describe('Field type determines the editor UI'),
				value: z.string().describe('Initial CSS value (e.g., "#3b82f6" for color, "16px" for size, "Inter" for font)'),
				description: z.string().optional().describe('Optional description of what this design field controls')
			}),
			execute: async ({ name, type, value, description }: { name: string; type: string; value: string; description?: string }) => {
				const project = await getProject(project_id)
				if (!project) throw new Error('Project not found')
				const design = project.design || []

				// Auto-generate CSS variable from name
				const css_var = '--' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

				// Check for duplicates
				if (design.find((f: any) => f.css_var === css_var)) {
					return `Design field with CSS variable "${css_var}" already exists`
				}

				const new_field: any = {
					id: Date.now().toString(),
					name,
					css_var,
					value,
					type,
					description: description || ''
				}

				if (type === 'size' || type === 'radius') {
					new_field.unit = 'px'
					if (type === 'radius') {
						new_field.min = 0
						new_field.max = 50
					}
				}

				design.push(new_field)
				await updateProject(project_id, { design })
				return `Created ${type} design field "${name}" (${css_var}) with value: ${value}`
			}
		}),

		create_data_file: tool({
			description: `Create a persistent data collection stored in the database. Use this for ALL app data that needs to persist across page refreshes (todos, users, posts, settings, etc.). After creating, access via: import data from '$data'; data.todos.subscribe(items => ...)`,
			inputSchema: z.object({
				filename: z.string().describe('Collection name (e.g., "todos", "users", "products")'),
				initial_data: z.string().describe('JSON array of initial records'),
				description: z.string().optional().describe('Optional description of what this collection stores')
			}),
			execute: async ({ filename, initial_data }: { filename: string; initial_data: string; description?: string }) => {
				const project = await getProject(project_id)
				if (!project) throw new Error('Project not found')
				const current_data = project.data || {}

				if (current_data[filename]) {
					return `Collection "${filename}" already exists`
				}

				const records = JSON.parse(initial_data)
				if (!Array.isArray(records)) {
					throw new Error('initial_data must be a JSON array')
				}

				// Add IDs to records
				const now = new Date().toISOString()
				const records_with_ids = records.map(r => ({
					id: r.id || Math.random().toString(36).slice(2, 7),
					...r,
					created: r.created || now,
					updated: r.updated || now
				}))

				// Infer schema
				const schema: Array<{ name: string; type: string }> = []
				if (records_with_ids.length > 0) {
					for (const [key, value] of Object.entries(records_with_ids[0])) {
						if (['id', 'created', 'updated'].includes(key)) continue
						let type = 'text'
						if (typeof value === 'number') type = 'number'
						else if (typeof value === 'boolean') type = 'boolean'
						schema.push({ name: key, type })
					}
				}

				current_data[filename] = { schema, records: records_with_ids }
				await updateProject(project_id, { data: current_data })
				return `Created collection "${filename}" with ${records.length} records`
			}
		}),

		insert_records: tool({
			description: 'Insert multiple records into an existing data collection.',
			inputSchema: z.object({
				collection: z.string().describe('Collection name (e.g., "todos", "users")'),
				records: z.string().describe('JSON array of records to insert')
			}),
			execute: async ({ collection, records: records_json }: { collection: string; records: string }) => {
				const project = await getProject(project_id)
				if (!project) throw new Error('Project not found')
				const current_data = project.data || {}

				if (!current_data[collection]) {
					return `Collection "${collection}" does not exist`
				}

				const new_records = JSON.parse(records_json)
				if (!Array.isArray(new_records)) {
					throw new Error('records must be a JSON array')
				}

				const now = new Date().toISOString()
				const new_records_with_ids = new_records.map(r => ({
					id: r.id || Math.random().toString(36).slice(2, 7),
					...r,
					created: r.created || now,
					updated: r.updated || now
				}))

				const collection_data = current_data[collection]
				const existing = Array.isArray(collection_data) ? collection_data : (collection_data.records || [])
				const all_records = [...existing, ...new_records_with_ids]

				current_data[collection] = {
					schema: collection_data.schema || [],
					records: all_records
				}
				await updateProject(project_id, { data: current_data })
				return `Inserted ${new_records.length} records into "${collection}"`
			}
		}),

		update_spec: tool({
			description: 'Update the project specification document to reflect current architecture and components',
			inputSchema: z.object({
				content: z.string().describe('Full markdown content of the updated specification')
			}),
			execute: async ({ content }: { content: string }) => {
				await updateProject(project_id, { custom_instructions: content })
				return 'Updated project specification'
			}
		})
	}
}

export async function run_agent(
	config: AgentConfig,
	project_id: string,
	messages: AgentMessage[],
	spec?: string,
	callbacks?: StreamCallbacks
): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number } }> {
	const model = get_model(config)
	const tools = create_tools(project_id)

	// Build system prompt with spec if provided
	let system = SYSTEM_PROMPT
	if (spec?.trim()) {
		system += `\n\n## Project Specification\n\n${spec}`
	}

	// Fetch current project state for context
	const project = await getProject(project_id)
	if (!project) throw new Error('Project not found')
	const current_code = project.frontend_code || ''
	const existing_design = project.design || []
	const existing_content = project.content || []

	let context = ''
	if (current_code.trim()) {
		context += `## Current App.svelte\n\`\`\`svelte\n${current_code}\n\`\`\`\n\n`
	}
	if (existing_design.length > 0) {
		context += `## Existing Design Fields (do not recreate)\n${existing_design.map((f: any) => `- ${f.name} (${f.css_var}): ${f.value}`).join('\n')}\n\n`
	}
	if (existing_content.length > 0) {
		context += `## Existing Content Fields (do not recreate)\n${existing_content.map((f: any) => `- ${f.name}: ${f.value}`).join('\n')}\n\n`
	}

	// Convert messages to CoreMessage format, prepending context to last user message
	const core_messages: CoreMessage[] = messages.map((m, i) => {
		if (m.role === 'user' && i === messages.length - 1 && context) {
			return { role: 'user' as const, content: context + m.content }
		}
		return { role: m.role as 'user' | 'assistant', content: m.content }
	})

	const result = streamText({
		model,
		system,
		messages: core_messages,
		tools,
		maxSteps: 100, // High limit to allow model to finish completely (default is 1 when tools present)
		toolCallStreaming: true,
		// Encourage text output before tool calls
		experimental_toolCallParallel: false, // Force sequential execution (think → act)
		// Temperature: balanced for reliable code + natural language
		temperature: 0.3
	} as any)

	// Stream both text and tool calls using fullStream
	let full_text = ''
	const seen_tool_calls = new Set<string>()

	for await (const part of result.fullStream) {
		// Log ALL event types to see what's happening
		const partStr = JSON.stringify(part)
		console.log('[SDK fullStream EVENT]', part.type, partStr.length > 300 ? partStr.slice(0, 300) + '...' : partStr)

		if (part.type === 'text-delta') {
			full_text += part.text
			callbacks?.onText?.(part.text)
		} else if (part.type === 'tool-input-start') {
			// Tool input streaming is starting
			console.log('[SDK tool-input-start] toolName:', (part as any).toolName)
			callbacks?.onToolCallStart?.((part as any).toolName)
		} else if (part.type === 'tool-call') {
			console.log('[SDK tool-call] toolName:', part.toolName, 'toolCallId:', (part as any).toolCallId)
			// Dedupe tool calls by toolCallId
			const toolCallId = (part as any).toolCallId
			if (toolCallId && seen_tool_calls.has(toolCallId)) continue
			if (toolCallId) seen_tool_calls.add(toolCallId)

			callbacks?.onToolCall?.(part.toolName, (part as any).input || {})
		} else if (part.type === 'tool-result') {
			// AI SDK stores tool results in 'output', not 'result'
			const resultValue = (part as any).output
			if (resultValue === undefined) {
				console.log('[SDK tool-result] SKIPPING - output is undefined')
				continue
			}
			console.log('[SDK tool-result] Sending to client:', part.toolName, String(resultValue).slice(0, 100))
			callbacks?.onToolResult?.(part.toolName, String(resultValue))
		} else if (part.type === 'finish') {
			// Stream finished - log finish reason
			const finishReason = (part as any).finishReason
			console.log('[SDK finish] Finish reason:', finishReason, 'Full text length:', full_text.length)
			if (finishReason === 'length') {
				console.warn('[SDK finish] WARNING: Response was cut off due to max token limit!')
			}
		}
	}

	const usage = await result.usage

	return {
		text: full_text,
		usage: {
			promptTokens: usage.inputTokens ?? 0,
			completionTokens: usage.outputTokens ?? 0
		}
	}
}

export function create_stream_response(
	config: AgentConfig,
	project_id: string,
	messages: AgentMessage[],
	spec?: string
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder()

	return new ReadableStream({
		async start(controller) {
			try {
				const result = await run_agent(config, project_id, messages, spec, {
					onText: (text) => {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: text })}\n\n`))
					},
					onToolCall: (name, args) => {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({ toolCall: { name, args } })}\n\n`))
					},
					onToolResult: (name, result) => {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({ toolResult: { name, result } })}\n\n`))
					},
					onError: (error) => {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`))
					}
				})
				// Send done with usage after streaming completes
				controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, usage: result.usage })}\n\n`))
			} catch (error: any) {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`))
			} finally {
				controller.close()
			}
		}
	})
}
