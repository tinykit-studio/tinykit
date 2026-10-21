import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { endpoint_for, type LLMProvider } from './config'

export interface AgentConfig {
	provider: LLMProvider
	apiKey: string
	model: string
	baseUrl?: string
}

export function get_model(config: AgentConfig) {
	switch (config.provider) {
		case 'openai':
		case 'openai-compatible':
		case 'deepseek': {
			const baseURL = endpoint_for({ provider: config.provider, base_url: config.baseUrl })
			if (config.provider === 'openai-compatible' && !baseURL) throw new Error('A custom base URL is required.')
			const openai = createOpenAI({
				apiKey: config.apiKey || '', baseURL,
				// Keyless servers should not receive an empty or ambient API credential.
				fetch: !config.apiKey && baseURL ? (url, init) => {
					const headers = new Headers(init?.headers)
					headers.delete('authorization')
					return fetch(url, { ...init, headers })
				} : undefined
			})
			return baseURL ? openai.chat(config.model) : openai(config.model)
		}
		case 'anthropic': return createAnthropic({ apiKey: config.apiKey })(config.model)
		case 'gemini': return createGoogleGenerativeAI({ apiKey: config.apiKey })(config.model)
		default: throw new Error(`Unknown provider: ${config.provider}`)
	}
}

export function get_summary_model(config: AgentConfig) {
	// Custom servers may expose just one model. Keep summaries on that server.
	const model = config.baseUrl || ['deepseek', 'openai-compatible'].includes(config.provider)
		? config.model
		: ({ openai: 'gpt-4o-mini', anthropic: 'claude-3-5-haiku-latest', gemini: 'gemini-2.0-flash-lite' } as Record<string, string>)[config.provider]
	return get_model({ ...config, model })
}
