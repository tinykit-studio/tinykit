import type { LLMProvider, LLMMessage, LLMUsage } from './types';
import { getToolsPrompt, executeTool } from './tools';
import { getProject, updateProject } from '$lib/server/pb';

const SYSTEM_PROMPT = `You are a code assistant for tinykit, building small web apps.

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

## Data API
\`\`\`javascript
import data from '$data'

// Subscribe for realtime updates (returns unsubscribe fn)
$effect(() => data.todos.subscribe(items => { todos = items; loading = false }))

// CRUD - realtime auto-updates UI
await data.todos.create({ title: 'New' })
await data.todos.update(id, { done: true })
await data.todos.delete(id)
\`\`\`

## Proxy API (for external data)
\`\`\`javascript
import { proxy } from '$tinykit'

// Fetch JSON from external API
const data = await proxy.json('https://api.example.com/data')

// Fetch text (RSS, HTML, XML)
const rss = await proxy.text('https://hnrss.org/frontpage')

// Raw fetch for full control
const response = await proxy('https://example.com/api')

// URL for media src attributes (audio, img)
<audio src={proxy.url('https://example.com/podcast.mp3')} />
\`\`\`
Use proxy when fetching external URLs that would be blocked by CORS (most RSS feeds, external APIs, podcast audio, etc.)

## Responsive Layout
- Mobile-first: base styles for small screens, media queries for larger
- Stack layouts vertically by default, horizontal on wider screens
- Use relative units (%, rem, fr) not fixed px widths
- Touch-friendly: buttons/links min 44px tap target

\`\`\`css
/* Mobile-first pattern */
.container { padding: 1rem; }
.grid { display: flex; flex-direction: column; gap: 1rem; }

@media (min-width: 768px) {
  .container { padding: 2rem; }
  .grid { flex-direction: row; }
}
\`\`\`

## Workflow
1. Brief plan (2-4 lines) for new apps, skip for fixes
2. Use write_code tool to save App.svelte (code blocks don't save)
3. IMMEDIATELY after write_code, create:
   - Design fields for ALL colors, fonts, radii, shadows
   - Content fields for ALL user-facing text

## Design Fields
Use CSS vars with fallbacks, then create fields:
\`\`\`css
.card { background: var(--card-background, #ffffff); }
\`\`\`
\`\`\`
<tool><name>create_design_field</name><parameters>{"name": "Card Background", "type": "color", "value": "#ffffff"}</parameters></tool>
\`\`\`
Types: color, font, radius, shadow, size, text. Name descriptively (not "Primary" or "Surface").

## Content Fields
Reference in code, then create:
\`\`\`svelte
<h1>{content.hero_title}</h1>
\`\`\`
\`\`\`
<tool><name>create_content_field</name><parameters>{"name": "Hero Title", "type": "text", "value": "Welcome"}</parameters></tool>
\`\`\`
Extract ALL text: titles, buttons, placeholders, empty states, messages.

## Common Mistakes (AVOID)
- \`$derived(items.filter(...))\` → use \`$derived.by(() => items.filter(...))\` for callbacks
- \`result.sort()\` in $derived → use \`[...result].sort()\` (sort mutates, copy first)
- Missing return in $effect → \`$effect(() => { return data.x.subscribe(...) })\` for cleanup
- \`on:click\` → use \`onclick\` (Svelte 5)
- \`export let x\` → use \`let { x } = $props()\` (Svelte 5)
- No loading state → always \`let loading = $state(true)\`, set false in subscribe callback
- Code in markdown → use write_code tool (markdown blocks don't save)
- Generic field names → "Card Background" not "Primary Color"
- Missing fallback → \`var(--x, #default)\` not \`var(--x)\`

${getToolsPrompt()}`;

export interface CodeBlock {
	language: string;
	filename: string;
	content: string;
}

export interface ToolCall {
	name: string;
	parameters: Record<string, any>;
}

export class Agent {
	private provider: LLMProvider;
	private projectId: string;
	private conversationHistory: LLMMessage[] = [];

	constructor(provider: LLMProvider, projectId: string) {
		this.provider = provider;
		this.projectId = projectId;
		this.conversationHistory.push({
			role: 'system',
			content: SYSTEM_PROMPT
		});
	}

	async processPrompt(userPrompt: string): Promise<{
		response: string;
		codeBlocks: CodeBlock[];
	}> {
		// Fetch current project state to include as context
		const project = await getProject(this.projectId)
		const currentCode = project.frontend_code || ''
		const existingDesign = project.design || []
		const existingContent = project.content || []

		// Build contextual prompt with current code and existing fields
		let contextualPrompt = ''

		if (currentCode.trim()) {
			contextualPrompt += `## Current App.svelte
\`\`\`svelte
${currentCode}
\`\`\`

`
		}

		if (existingDesign.length > 0) {
			contextualPrompt += `## Existing Design Fields (do not recreate these)
${existingDesign.map((f: any) => `- ${f.name} (${f.css_var}): ${f.value}`).join('\n')}

`
		}

		if (existingContent.length > 0) {
			contextualPrompt += `## Existing Content Fields (do not recreate these)
${existingContent.map((f: any) => `- ${f.name}: ${f.value}`).join('\n')}

`
		}

		contextualPrompt += `## User Request
${userPrompt}`

		// Add user message to history
		this.conversationHistory.push({
			role: 'user',
			content: contextualPrompt
		});

		// Get response from LLM
		const llmResponse = await this.provider.generate(this.conversationHistory);

		// Add assistant response to history
		this.conversationHistory.push({
			role: 'assistant',
			content: llmResponse.content
		});

		// Extract code blocks
		const codeBlocks = this.extractCodeBlocks(llmResponse.content);

		return {
			response: llmResponse.content,
			codeBlocks
		};
	}

	async *streamPrompt(userPrompt: string, spec?: string): AsyncGenerator<{ content?: string; usage?: LLMUsage }> {
		if (!this.provider.stream) {
			throw new Error('Streaming not supported by this provider');
		}

		// Fetch current project state to include as context
		const project = await getProject(this.projectId)
		const currentCode = project.frontend_code || ''
		const existingDesign = project.design || []
		const existingContent = project.content || []

		// Update system prompt with spec if provided
		if (spec && spec.trim()) {
			this.conversationHistory[0] = {
				role: 'system',
				content: `${SYSTEM_PROMPT}

## Project Specification

The following is the project specification document that describes the current state, architecture, and goals of this project:

${spec}

Use this specification to inform your responses and ensure consistency with the project's architecture and requirements.`
			};
		}

		// Build contextual prompt with current code and existing fields
		let contextualPrompt = ''

		if (currentCode.trim()) {
			contextualPrompt += `## Current App.svelte
\`\`\`svelte
${currentCode}
\`\`\`

`
		}

		if (existingDesign.length > 0) {
			contextualPrompt += `## Existing Design Fields (do not recreate these)
${existingDesign.map((f: any) => `- ${f.name} (${f.css_var}): ${f.value}`).join('\n')}

`
		}

		if (existingContent.length > 0) {
			contextualPrompt += `## Existing Content Fields (do not recreate these)
${existingContent.map((f: any) => `- ${f.name}: ${f.value}`).join('\n')}

`
		}

		contextualPrompt += `## User Request
${userPrompt}`

		// Add user message to history
		this.conversationHistory.push({
			role: 'user',
			content: contextualPrompt
		});

		let fullResponse = '';
		let accumulatedUsage: LLMUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

		// Stream response from LLM
		for await (const chunk of this.provider.stream(this.conversationHistory)) {
			if (chunk.content) {
				fullResponse += chunk.content;
				yield { content: chunk.content };
			}
			if (chunk.usage) {
				// Accumulate usage (Anthropic sends input tokens at start, output at end)
				if (chunk.usage.promptTokens > 0) {
					accumulatedUsage.promptTokens = chunk.usage.promptTokens;
				}
				if (chunk.usage.completionTokens > 0) {
					accumulatedUsage.completionTokens = chunk.usage.completionTokens;
				}
				accumulatedUsage.totalTokens = accumulatedUsage.promptTokens + accumulatedUsage.completionTokens;
			}
		}

		// Yield final usage stats
		if (accumulatedUsage.totalTokens > 0) {
			yield { usage: accumulatedUsage };
		}

		// Add assistant response to history
		this.conversationHistory.push({
			role: 'assistant',
			content: fullResponse
		});
	}

	getModel(): string {
		return this.provider.model;
	}

	extractCodeBlocks(text: string): CodeBlock[] {
		const codeBlockRegex = /```(\w+):([^\n]+)\n([\s\S]*?)```/g;
		const blocks: CodeBlock[] = [];

		let match;
		while ((match = codeBlockRegex.exec(text)) !== null) {
			blocks.push({
				language: match[1],
				filename: match[2].trim(),
				content: match[3]
			});
		}

		return blocks;
	}

	extractToolCalls(text: string): ToolCall[] {
		const toolRegex = /<tool>\s*<name>(.*?)<\/name>\s*<parameters>([\s\S]*?)<\/parameters>\s*<\/tool>/g;
		const calls: ToolCall[] = [];

		let match;
		while ((match = toolRegex.exec(text)) !== null) {
			try {
				const name = match[1].trim();
				const parameters = JSON.parse(match[2].trim());
				calls.push({ name, parameters });
			} catch (e) {
				console.error('Failed to parse tool call:', e);
			}
		}

		return calls;
	}

	async executeToolCalls(toolCalls: ToolCall[]): Promise<string[]> {
		const results: string[] = [];
		for (const call of toolCalls) {
			const result = await executeTool(this.projectId, call.name, call.parameters);
			results.push(result);
		}
		return results;
	}

	async applyCodeBlocks(codeBlocks: CodeBlock[]): Promise<void> {
		for (const block of codeBlocks) {
			// Only handle App.svelte - build system generates index.html
			if (block.filename.includes('App.svelte')) {
				await updateProject(this.projectId, { frontend_code: block.content });
			}
		}
	}

	getHistory(): LLMMessage[] {
		return this.conversationHistory;
	}

	clearHistory(): void {
		this.conversationHistory = [
			{
				role: 'system',
				content: SYSTEM_PROMPT
			}
		];
	}
}
