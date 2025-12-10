import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMMessage, LLMResponse, LLMStreamChunk } from '../types';

export class AnthropicProvider implements LLMProvider {
	private client: Anthropic;
	model: string;
	private web_search_enabled: boolean;

	constructor(apiKey: string, model: string = 'claude-opus-4-5-20251101', webSearch: boolean = false) {
		this.client = new Anthropic({ apiKey });
		this.model = model;
		this.web_search_enabled = webSearch;
	}

	private get_tools(): any[] | undefined {
		if (!this.web_search_enabled) return undefined;
		return [{
			type: 'web_search_20250305',
			name: 'web_search',
			max_uses: 5
		}];
	}

	async generate(messages: LLMMessage[]): Promise<LLMResponse> {
		// Extract system message if present
		const systemMessage = messages.find((m) => m.role === 'system');
		const conversationMessages = messages.filter((m) => m.role !== 'system');

		const response = await this.client.messages.create({
			model: this.model,
			max_tokens: 64000,
			temperature: 0,
			system: systemMessage?.content,
			messages: conversationMessages.map((m) => ({
				role: m.role === 'user' ? 'user' : 'assistant',
				content: m.content
			})),
			tools: this.get_tools()
		} as any);

		const textContent = response.content.find((c) => c.type === 'text');
		return {
			content: textContent?.type === 'text' ? textContent.text : '',
			usage: {
				promptTokens: response.usage.input_tokens,
				completionTokens: response.usage.output_tokens,
				totalTokens: response.usage.input_tokens + response.usage.output_tokens
			}
		};
	}

	async *stream(messages: LLMMessage[]): AsyncGenerator<LLMStreamChunk> {
		const systemMessage = messages.find((m) => m.role === 'system');
		const conversationMessages = messages.filter((m) => m.role !== 'system');

		const stream = await this.client.messages.create({
			model: this.model,
			max_tokens: 64000,
			temperature: 0,
			system: systemMessage?.content,
			messages: conversationMessages.map((m) => ({
				role: m.role === 'user' ? 'user' : 'assistant',
				content: m.content
			})),
			stream: true,
			tools: this.get_tools()
		} as any);

		for await (const event of stream) {
			if (
				event.type === 'content_block_delta' &&
				event.delta.type === 'text_delta'
			) {
				yield { content: event.delta.text };
			} else if (event.type === 'message_delta' && event.usage) {
				// Final message with usage stats including web search count
				const usage = event.usage as any;
				yield {
					usage: {
						promptTokens: 0,
						completionTokens: usage.output_tokens,
						totalTokens: usage.output_tokens,
						webSearches: usage.server_tool_use?.web_search_requests || 0
					}
				};
			} else if (event.type === 'message_start' && event.message?.usage) {
				// Initial message with input token count
				yield {
					usage: {
						promptTokens: event.message.usage.input_tokens,
						completionTokens: 0,
						totalTokens: event.message.usage.input_tokens
					}
				};
			}
		}
	}
}
