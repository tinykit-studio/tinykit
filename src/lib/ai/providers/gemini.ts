import { GoogleGenAI, type Chat, type Content } from '@google/genai'
import type { LLMProvider, LLMMessage, LLMResponse, LLMStreamChunk } from '../types'

export class GeminiProvider implements LLMProvider {
	private client: GoogleGenAI
	model: string
	private web_search_enabled: boolean

	constructor(apiKey: string, model: string = 'gemini-3-pro-preview', webSearch: boolean = false) {
		this.client = new GoogleGenAI({ apiKey })
		this.model = model
		this.web_search_enabled = webSearch
	}

	private convert_messages(messages: LLMMessage[]): { system?: string; contents: Content[] } {
		let system_instruction: string | undefined
		const contents: Content[] = []

		for (const msg of messages) {
			if (msg.role === 'system') {
				system_instruction = msg.content
			} else {
				contents.push({
					role: msg.role === 'assistant' ? 'model' : 'user',
					parts: [{ text: msg.content }]
				})
			}
		}

		return { system: system_instruction, contents }
	}

	private get_tools(): any[] | undefined {
		if (!this.web_search_enabled) return undefined
		return [{ googleSearch: {} }]
	}

	async generate(messages: LLMMessage[]): Promise<LLMResponse> {
		const { system, contents } = this.convert_messages(messages)

		const response = await this.client.models.generateContent({
			model: this.model,
			contents,
			config: {
				systemInstruction: system,
				tools: this.get_tools()
			}
		})

		const text = response.text || ''
		const usage = response.usageMetadata

		return {
			content: text,
			usage: usage
				? {
						promptTokens: usage.promptTokenCount || 0,
						completionTokens: usage.candidatesTokenCount || 0,
						totalTokens: usage.totalTokenCount || 0
					}
				: undefined
		}
	}

	async *stream(messages: LLMMessage[]): AsyncGenerator<LLMStreamChunk> {
		const { system, contents } = this.convert_messages(messages)

		const response = await this.client.models.generateContentStream({
			model: this.model,
			contents,
			config: {
				systemInstruction: system,
				tools: this.get_tools()
			}
		})

		let total_prompt_tokens = 0
		let total_completion_tokens = 0

		for await (const chunk of response) {
			const text = chunk.text
			if (text) {
				yield { content: text }
			}

			// Track usage from each chunk
			if (chunk.usageMetadata) {
				total_prompt_tokens = chunk.usageMetadata.promptTokenCount || 0
				total_completion_tokens = chunk.usageMetadata.candidatesTokenCount || 0
			}
		}

		// Yield final usage
		if (total_prompt_tokens > 0 || total_completion_tokens > 0) {
			yield {
				usage: {
					promptTokens: total_prompt_tokens,
					completionTokens: total_completion_tokens,
					totalTokens: total_prompt_tokens + total_completion_tokens
				}
			}
		}
	}
}
