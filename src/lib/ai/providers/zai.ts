import OpenAI from 'openai'
import type { LLMProvider, LLMMessage, LLMResponse, LLMStreamChunk } from '../types'

export class ZAIProvider implements LLMProvider {
	private client: OpenAI
	model: string
	private web_search_enabled: boolean

	constructor(apiKey: string, model: string = 'glm-4.6', baseUrl?: string, webSearch: boolean = false) {
		this.client = new OpenAI({
			apiKey,
			baseURL: baseUrl || 'https://api.z.ai/api/paas/v4'
		})
		this.model = model
		this.web_search_enabled = webSearch
	}

	private get_tools(): any[] | undefined {
		if (!this.web_search_enabled) return undefined
		return [{
			type: 'web_search',
			web_search: {
				enable: true,
				search_engine: 'search-prime',
				search_result: true
			}
		}]
	}

	async generate(messages: LLMMessage[]): Promise<LLMResponse> {
		const response = await this.client.chat.completions.create({
			model: this.model,
			temperature: 0,
			messages: messages.map((m) => ({
				role: m.role,
				content: m.content
			})),
			tools: this.get_tools()
		} as any)

		const choice = response.choices[0]
		return {
			content: choice.message.content || '',
			usage: response.usage
				? {
						promptTokens: response.usage.prompt_tokens,
						completionTokens: response.usage.completion_tokens,
						totalTokens: response.usage.total_tokens
					}
				: undefined
		}
	}

	async *stream(messages: LLMMessage[]): AsyncGenerator<LLMStreamChunk> {
		const stream = await this.client.chat.completions.create({
			model: this.model,
			temperature: 0,
			messages: messages.map((m) => ({
				role: m.role,
				content: m.content
			})),
			stream: true,
			stream_options: { include_usage: true },
			tools: this.get_tools()
		} as any)

		let webSearchCount = 0

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta as any
			const content = delta?.content || ''
			if (content) {
				yield { content }
			}
			// Z.ai signals web search via tool_calls in the delta
			if (delta?.tool_calls) {
				for (const tc of delta.tool_calls) {
					if (tc.type === 'web_search' || tc.function?.name === 'web_search') {
						webSearchCount++
					}
				}
			}
			if (chunk.usage) {
				yield {
					usage: {
						promptTokens: chunk.usage.prompt_tokens,
						completionTokens: chunk.usage.completion_tokens,
						totalTokens: chunk.usage.total_tokens,
						webSearches: webSearchCount
					}
				}
			}
		}
	}
}
