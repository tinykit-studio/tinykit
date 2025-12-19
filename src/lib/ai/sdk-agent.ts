import { streamText, tool, type CoreMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import {
	getProject,
	updateProject,
	addContentField,
	addDesignField,
	addDataCollection,
	insertDataRecords
} from '$lib/server/pb'

export type LLMProvider = 'openai' | 'anthropic' | 'gemini'

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
	onToolCallStart?: (toolCallId: string, toolName: string) => void
	onToolCall?: (toolCallId: string, toolName: string, args: Record<string, any>) => void
	onToolResult?: (toolCallId: string, toolName: string, result: string) => void
	onError?: (error: Error) => void
}

const SYSTEM_PROMPT = `You are a code assistant for tinykit, building small web apps.

Response format:
1. For SUBSTANTIAL tasks (building new features, major changes):
   - Start with a numbered plan (3-5 items):
     "I'll build a pins app:
     1. Pinterest-style grid layout with masonry
     2. Pin cards with image, title, description
     3. Modal for viewing/editing individual pins
     4. Local database for storing pins
     5. Search and filter functionality"
   - Then call tools silently

2. For SIMPLE tasks (small tweaks, single changes):
   - Brief explanation ("I'll change the button color to red")
   - Then call tools

3. For QUESTIONS (no tools needed):
   - Just answer directly

Tool calling rules:
- Use the native function calling API to invoke tools - NEVER write tool calls as text or code
- DO NOT show tool names, arguments, or JSON in your response text
- DO NOT write "import { tool_name }" or "tool_name({ ... })" - that's wrong
- After your brief plan, invoke tools using the API (they appear as badges in the UI)

WRONG: Writing \`write_code({ code: "..." })\` as text ❌
WRONG: Showing \`\`\`json {...}\`\`\` or \`\`\`javascript import {...}\`\`\` ❌
WRONG: Simulating tool calls in your response ❌
RIGHT: Brief explanation → then invoke tools via function calling API ✅

## Architecture
- Single Svelte 5 file with standard CSS in <style global> (make sure you use this so styles are global!)
- NO Tailwind/utility classes - use semantic class names (.card, .button)
- Data via \`import data from '$data'\` with realtime subscriptions
- Content via \`import content from '$content'\` for editable text
- Design via CSS variables - ALWAYS use var(--name, fallback) for colors, fonts, spacing, border-radius, shadows
- External data via \`import { proxy } from '$tinykit'\` for fetching external APIs/RSS/audio

## Svelte 5 Runes (REQUIRED - Svelte 4 syntax will break)
\`\`\`javascript
let count = $state(0)                                      // reactive state
let doubled = $derived(count * 2)                          // simple expressions ONLY
let filtered = $derived.by(() => items.filter(x => x.done)) // use .by() for callbacks/filters
let sorted = $derived.by(() => [...items].sort((a,b) => a.name.localeCompare(b.name))) // COPY before sort!
$effect(() => { /* side effects, return cleanup fn */ })
\`\`\`

**NEVER use .sort() directly on $state arrays** - it mutates. Always copy first: \`[...arr].sort()\`

Events: \`onclick={fn}\` (not on:click). No pipe modifiers - call e.preventDefault() in handler.
Bindings: \`bind:value\` works in Svelte 5.

## Icons
\`\`\`svelte
import Icon from '@iconify/svelte'

// Basic usage (no styling)
<Icon icon="lucide:search" width={18} />

// When styling is needed, wrap in element (Svelte styles can't reach into components)
<span class="icon-search">
  <Icon icon="lucide:search" width={18} />
</span>

<style>
.icon-search {
  color: var(--icon-color);
  display: inline-flex;
}
</style>
\`\`\`
Common icons: plus, x, edit, trash-2, search, settings, user, home, heart, star, bookmark, check, menu, chevron-down, arrow-left, loader-2, grid, list, eye, filter. Format: \`lucide:icon-name\`

## Data API (Persistent Database)
\`\`\`javascript
import data from '$data'

let todos = $state([])
let loading = $state(true)

// Subscribe at top level - NO onMount, NO $effect wrapper needed
data.todos.subscribe(items => { todos = items; loading = false })

// CRUD operations - changes save to database, realtime auto-updates UI
await data.todos.create({ title: 'New' })
await data.todos.update(id, { done: true })
await data.todos.delete(id)
\`\`\`

**IMPORTANT:** Call subscribe() directly at top level. Do NOT wrap in onMount() or $effect().

**When to use:** ANY app data that needs to persist (todos, users, posts, notes, bookmarks, settings, etc.)

## File Fields in Data Collections
When creating collections with images/files, define schema with type "file" or "files":
\`\`\`javascript
// Create collection with explicit file field schema
create_data_file({
  filename: 'products',
  schema: [
    { name: 'name', type: 'text' },
    { name: 'price', type: 'number' },
    { name: 'image', type: 'file' }
  ],
  initial_data: JSON.stringify([
    { name: 'Widget', price: 29.99, image: 'placeholder.jpg' }
  ]),
  icon: 'lucide:shopping-bag'
})
\`\`\`
**Always include an icon** (e.g., \`lucide:users\`, \`lucide:check-square\`, \`lucide:file-text\`).

**Placeholders:** Use for demo data - "placeholder.jpg" (square), "placeholder-avatar.jpg" (avatar), "placeholder-wide.jpg" (16:9)

**Display images:** File field values are filenames, use the \`asset()\` helper from \`$tinykit\`:
\`\`\`svelte
<script>
  import { asset } from '$tinykit'
</script>
<img src={asset(product.image)} alt={product.name} />
<!-- With thumbnail: asset(product.image, { thumb: '200x200' }) -->
\`\`\`

**File uploads in app UI:** Use a file input, then pass File object to create/update - auto-uploaded:
\`\`\`svelte
<input type="file" accept="image/*" onchange={(e) => file = e.currentTarget.files[0]} />
<button onclick={() => data.products.create({ name, price, image: file })}>Add</button>
\`\`\`

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
1. Start with numbered plan (3-5 items as shown above)
2. Call write_code tool to save Svelte code
3. IMMEDIATELY after write_code, create design fields for colors/fonts/radii and content fields for text

## Design Fields (REQUIRED for every CSS variable)
**EVERY var(--X) in your code MUST have a matching create_design_field call.** No exceptions.

Design fields are auto-injected as CSS variables. Use them with fallbacks:
\`\`\`css
.card { background: var(--card-bg, #ffffff); }
\`\`\`
After write_code, IMMEDIATELY call create_design_field for each CSS variable used. Types: color, font, radius, shadow, size, text.

**Fonts:** Web fonts are auto-loaded from Bunny Fonts CDN. Just use the font name (e.g., "Inter", "Playfair Display") - no @import or link tags needed.

## Content Fields (REQUIRED for all user-facing text AND images)
NEVER hardcode text or images users might want to edit. Use content fields for:
- **Text:** titles, buttons, labels, placeholders, empty states, messages, nav items
- **Images:** avatars, logos, hero images, profile photos, testimonial photos, team member photos
- **Markdown:** bios, descriptions, rich text - auto-converted to HTML at runtime

\`\`\`svelte
<h1>{content.hero_title}</h1>
<button>{content.add_button}</button>
<p class="empty">{content.no_items_message}</p>
<img src={content.hero_image} alt="" />
<img src={content.user_avatar} alt="User" class="avatar" />
<div class="bio">{@html content.author_bio}</div>  <!-- markdown fields need {@html} -->
\`\`\`

When creating image content fields, use type: "image" (not "text"). This gives users a proper image upload UI in the Content tab.
When creating markdown content fields, use type: "markdown" - the value is auto-converted to HTML, so render with \`{@html content.field}\`.

## Common Mistakes (AVOID)
- Hardcoding colors/fonts/spacing → use var(--name, fallback) for ALL design values
- Using var(--X) without create_design_field → EVERY CSS variable needs a design field
- Hardcoding "Submit", "Welcome" → use content fields for user-facing text
- Using type:"text" for avatar/logo/photo → use type:"image" for proper upload UI
- \`$derived(items.filter(...))\` → use \`$derived.by(() => items.filter(...))\` for callbacks
- \`result.sort()\` in $derived → use \`[...result].sort()\` (sort mutates, copy first)
- \`on:click\` → use \`onclick\` (Svelte 5)
- \`export let x\` → use \`let { x } = $props()\` (Svelte 5)
- No loading state → always \`let loading = $state(true)\`, set false in subscribe callback

## UX Polish
- Use \`transition:fade={{ duration: 100 }}\` for dialogs and list items
- Import: \`import { fade } from 'svelte/transition'\`

## NPM Packages
Any npm package works with bare imports - auto-resolved via esm.sh:
\`\`\`javascript
import dayjs from 'dayjs'
import confetti from 'canvas-confetti'
\`\`\``

function get_model(config: AgentConfig) {
	switch (config.provider) {
		case 'openai': {
			const openai = createOpenAI({
				apiKey: config.apiKey
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

function create_tools(project_id: string, project_name: string) {
	const tools: any = {
		write_code: tool({
			description: 'Write client-side code. Use this to create or update the application code.',
			inputSchema: z.object({
				code: z.string().describe('The complete Svelte 5 application code file')
			}),
			execute: async ({ code }: { code: string }) => {
				// Post-process: fix common syntax errors
				let cleaned_code = code
					// Fix {/#each} → {/each}
					.replace(/\{\/\#each\}/g, '{/each}')
					// Fix {/#if} → {/if}
					.replace(/\{\/\#if\}/g, '{/if}')
					// Fix {/#await} → {/await}
					.replace(/\{\/\#await\}/g, '{/await}')
					// Fix {/#key} → {/key}
					.replace(/\{\/\#key\}/g, '{/key}')
					// Strip :root blocks - design system injects CSS vars at runtime
					.replace(/:root\s*\{[^}]*\}/g, '')

				// Note: onToolCall is triggered by stream events, not here (avoids duplicates)
				await updateProject(project_id, { frontend_code: cleaned_code })

				const fixes = code !== cleaned_code ? ' (auto-fixed syntax errors)' : ''
				return `Wrote application code (${cleaned_code.length} chars)${fixes}`
			}
		}),

		create_content_field: tool({
			description: `Create a CMS-like content field that can be edited without code changes. Content fields are automatically available in the app via: import content from '$content'. Field names are slugified (e.g., "Hero Title" becomes content.hero_title).

**Use 'image' type for:** avatars, logos, hero images, profile photos, thumbnails, icons - any visual that users should be able to swap out easily.`,
			inputSchema: z.object({
				name: z.string().describe('Field name (e.g., "Hero Title", "User Avatar", "Logo")'),
				type: z.enum(['text', 'markdown', 'number', 'boolean', 'json', 'image']).describe('Field type: text (short strings), markdown (rich text/bios), number, boolean (toggles), json (structured data), image (avatars/photos/logos)'),
				value: z.string().describe('Initial value. For images, use a placeholder URL or leave empty. For boolean, use "true" or "false"'),
				description: z.string().optional().describe('Optional description of what this field is for')
			}),
			execute: async ({ name, type, value, description }: { name: string; type: string; value: string; description?: string }) => {
				// Use atomic operation to prevent race conditions when creating multiple fields
				const result = await addContentField(project_id, { name, type, value, description })
				if (!result) {
					return `Content field "${name}" already exists`
				}
				return `Created content field "${name}" (${type}) with value: ${value}`
			}
		}),

		create_design_field: tool({
			description: `Create a design field (CSS variable) for styling the app. Design fields appear in the Design tab with specialized editors based on type.

Field types: color, size, font, radius, shadow, text

IMPORTANT: Always pass the exact css_var you used in code to avoid mismatches.
Example: If code uses var(--font-main), pass css_var: "--font-main"`,
			inputSchema: z.object({
				name: z.string().describe('Human-readable field name (e.g., "Main Font", "Card Background")'),
				css_var: z.string().optional().describe('Exact CSS variable name used in code (e.g., "--font-main"). Must match what you wrote in the code.'),
				type: z.enum(['color', 'size', 'font', 'radius', 'shadow', 'text']).describe('Field type determines the editor UI'),
				value: z.string().describe('Initial CSS value (e.g., "#3b82f6" for color, "16px" for size, "Inter" for font)'),
				description: z.string().optional().describe('Optional description of what this design field controls')
			}),
			execute: async ({ name, css_var: explicit_css_var, type, value, description }: { name: string; css_var?: string; type: string; value: string; description?: string }) => {
				// Use explicit css_var if provided, otherwise auto-generate from name
				const css_var = explicit_css_var || ('--' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))

				// Use atomic operation to prevent race conditions when creating multiple fields
				const result = await addDesignField(project_id, { name, css_var, type, value, description })
				if (!result) {
					return `Design field with CSS variable "${css_var}" already exists`
				}
				return `Created ${type} design field "${name}" (${css_var}) with value: ${value}`
			}
		}),

		create_data_file: tool({
			description: `Create a persistent data collection stored in the database. Use this for ALL app data that needs to persist across page refreshes (todos, users, posts, settings, etc.). After creating, access via: import data from '$data'; data.todos.subscribe(items => ...)

**Type inference guide - use appropriate types for these column patterns:**
- date: created_at, updated_at, due_date, timestamp, *_at, *_date
- file: image, avatar, photo, thumbnail, cover, attachment
- files: images, photos, attachments, gallery
- boolean: is_*, has_*, done, completed, active, enabled, published
- number: price, count, quantity, amount, total, score, rating, age, *_count
- json: metadata, config, settings, options, tags (for arrays)

For file fields, use placeholder images for demo data: "placeholder.jpg" (square), "placeholder-avatar.jpg" (avatar), "placeholder-wide.jpg" (16:9 banner).`,
			inputSchema: z.object({
				filename: z.string().describe('Collection name (e.g., "todos", "users", "products")'),
				schema: z.array(z.object({
					name: z.string(),
					type: z.enum(['id', 'text', 'number', 'boolean', 'date', 'json', 'file', 'files'])
				})).describe('Column definitions. Use the type inference guide above. An "id" column with type "id" is auto-added at the start. For relationships, use explicit IDs in both collections (e.g., author_id: "u1" referencing a user with id: "u1").'),
				initial_data: z.string().describe('JSON array of initial records. For file fields, use placeholder values like "placeholder.jpg"'),
				icon: z.string().optional().describe('Iconify icon ID for the collection (e.g., "lucide:users", "lucide:shopping-cart", "lucide:file-text")'),
				description: z.string().optional().describe('Optional description of what this collection stores')
			}),
			execute: async ({ filename, schema, initial_data, icon }: { filename: string; schema: Array<{ name: string; type: string }>; initial_data: string; icon?: string; description?: string }) => {
				const records = JSON.parse(initial_data)
				if (!Array.isArray(records)) {
					throw new Error('initial_data must be a JSON array')
				}

				// Use atomic operation to prevent race conditions
				const result = await addDataCollection(project_id, { filename, schema, records, icon })
				return result.message
			}
		}),

		insert_records: tool({
			description: 'Insert multiple records into an existing data collection.',
			inputSchema: z.object({
				collection: z.string().describe('Collection name (e.g., "todos", "users")'),
				records: z.string().describe('JSON array of records to insert')
			}),
			execute: async ({ collection, records: records_json }: { collection: string; records: string }) => {
				const records = JSON.parse(records_json)
				if (!Array.isArray(records)) {
					throw new Error('records must be a JSON array')
				}

				// Use atomic operation to prevent race conditions
				const result = await insertDataRecords(project_id, collection, records)
				return result.message
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

	// Only allow naming if the project hasn't been named yet
	if (!project_name) {
		tools.name_project = tool({
			description: 'Name the project. Use this to set a descriptive name for the project based on the user\'s prompt or the app being built.',
			inputSchema: z.object({
				name: z.string().describe('The new name for the project')
			}),
			execute: async ({ name }: { name: string }) => {
				await updateProject(project_id, { name })
				return `Renamed project to "${name}"`
			}
		})
	}

	return tools
}

export async function run_agent(
	config: AgentConfig,
	project_id: string,
	messages: AgentMessage[],
	spec?: string,
	callbacks?: StreamCallbacks
): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number } }> {
	// Build system prompt with spec if provided
	let system = SYSTEM_PROMPT
	if (spec?.trim()) {
		system += `\n\n## Project Specification\n\n${spec}`
	}

	// Fetch current project state for context
	const project = await getProject(project_id)
	if (!project) throw new Error('Project not found')

	const model = get_model(config)
	const tools = create_tools(project_id, project.name)
	const current_code = project.frontend_code || ''
	const existing_design = project.design || []
	const existing_content = project.content || []

	let context = ''
	if (current_code.trim()) {
		context += `## Current application code\n\`\`\`svelte\n${current_code}\n\`\`\`\n\n`
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

	// OpenAI reasoning models (o1, o3) don't support temperature
	const is_reasoning_model = /^(o1|o3)/.test(config.model)

	const result = streamText({
		model,
		system,
		messages: core_messages,
		tools,
		maxSteps: 100, // High limit to allow model to finish completely (default is 1 when tools present)
		toolCallStreaming: true,
		// Encourage text output before tool calls
		experimental_toolCallParallel: false, // Force sequential execution (think → act)
		// Temperature: balanced for reliable code + natural language (not supported by reasoning models)
		temperature: is_reasoning_model ? undefined : 0.3
	} as any)

	// Stream both text and tool calls using fullStream
	let full_text = ''
	const seen_tool_calls = new Set<string>()

	for await (const part of result.fullStream) {
		if (part.type === 'text-delta') {
			full_text += part.text
			callbacks?.onText?.(part.text)
		} else if (part.type === 'tool-input-start') {
			const inputStart = part as any
			callbacks?.onToolCallStart?.(inputStart.toolCallId, inputStart.toolName)
		} else if (part.type === 'tool-call') {
			// Dedupe tool calls by toolCallId
			const toolCallId = (part as any).toolCallId
			if (toolCallId && seen_tool_calls.has(toolCallId)) continue
			if (toolCallId) seen_tool_calls.add(toolCallId)
			callbacks?.onToolCall?.(toolCallId, part.toolName, (part as any).input || {})
		} else if (part.type === 'tool-result') {
			// AI SDK 5.x uses 'output' property for tool results
			const resultValue = (part as any).output
			if (resultValue === undefined) continue
			const toolCallId = (part as any).toolCallId
			callbacks?.onToolResult?.(toolCallId, part.toolName, String(resultValue))
		} else if (part.type === 'tool-error') {
			const toolError = part as any
			console.error('[Agent] Tool failed:', toolError.toolName, toolError.error)
			callbacks?.onError?.(new Error(`Tool ${toolError.toolName} failed: ${toolError.error}`))
		} else if (part.type === 'finish') {
			const finishReason = (part as any).finishReason
			if (finishReason === 'length') {
				console.warn('[Agent] Response cut off due to max token limit')
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
					onToolCall: (id, name, args) => {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({ toolCall: { name, args } })}\n\n`))
					},
					onToolResult: (id, name, result) => {
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
