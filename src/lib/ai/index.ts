import type { LLMProvider, LLMConfig } from './types';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { ZAIProvider } from './providers/zai';
import { GeminiProvider } from './providers/gemini';

export function createLLMProvider(config: LLMConfig): LLMProvider {
	const webSearch = config.webSearch ?? false;

	switch (config.provider) {
		case 'openai':
			if (!config.apiKey) {
				throw new Error('OpenAI API key is required');
			}
			return new OpenAIProvider(config.apiKey, config.model, webSearch);

		case 'anthropic':
			if (!config.apiKey) {
				throw new Error('Anthropic API key is required');
			}
			return new AnthropicProvider(config.apiKey, config.model, webSearch);

		case 'gemini':
			if (!config.apiKey) {
				throw new Error('Gemini API key is required');
			}
			return new GeminiProvider(config.apiKey, config.model, webSearch);

		case 'ollama':
			throw new Error('Ollama provider not yet implemented');

		case 'zai':
			if (!config.apiKey) {
				throw new Error('z.ai API key is required');
			}
			return new ZAIProvider(config.apiKey, config.model, config.baseUrl, webSearch);

		default:
			throw new Error(`Unknown provider: ${config.provider}`);
	}
}

export * from './types';
export { OpenAIProvider } from './providers/openai';
export { AnthropicProvider } from './providers/anthropic';
export { ZAIProvider } from './providers/zai';
export { GeminiProvider } from './providers/gemini';
