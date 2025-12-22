// Usage tracking for cost calculation
export interface LLMUsage {
	promptTokens: number
	completionTokens: number
	totalTokens: number
	webSearches?: number
}

// Web search pricing per search (in USD)
export const WEB_SEARCH_PRICING: Record<string, number> = {
	openai: 0.03,
	anthropic: 0.01,
	gemini: 0.035
}

// Token pricing per 1M tokens (in USD)
export const TOKEN_PRICING: Record<string, { input: number; output: number }> = {
	// Anthropic models - https://claude.com/pricing
	'claude-opus-4-5-20251101': { input: 5.00, output: 25.00 },
	'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00 },
	'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
	'claude-opus-4-20250514': { input: 15.00, output: 75.00 },
	'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
	'claude-3-7-sonnet-20250219': { input: 3.00, output: 15.00 },
	'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
	'claude-3-5-sonnet-20240620': { input: 3.00, output: 15.00 },
	'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
	'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
	'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
	// OpenAI models - https://platform.openai.com/docs/pricing
	'gpt-4': { input: 30.00, output: 60.00 },
	'gpt-4-turbo': { input: 10.00, output: 30.00 },
	'gpt-4-turbo-preview': { input: 10.00, output: 30.00 },
	'gpt-4.1': { input: 2.00, output: 8.00 },
	'gpt-4.1-mini': { input: 0.40, output: 1.60 },
	'gpt-4.1-nano': { input: 0.10, output: 0.40 },
	'gpt-4o': { input: 2.50, output: 10.00 },
	'gpt-4o-mini': { input: 0.15, output: 0.60 },
	'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
	'o1': { input: 15.00, output: 60.00 },
	'o1-pro': { input: 150.00, output: 600.00 },
	'gpt-5.1': { input: 1.25, output: 10.00 },
	'gpt-5.1-codex': { input: 1.25, output: 10.00 },
	'gpt-5.2-2025-12-11': { input: 1.75, output: 14.00 },
	'gpt-5-mini': { input: 0.25, output: 2.00 },
	'o3': { input: 10.00, output: 40.00 },
	'o4-mini': { input: 0.15, output: 0.60 },
	// Gemini models - https://ai.google.dev/pricing
	'gemini-3-pro-preview': { input: 2.00, output: 12.00 },
	'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
	'gemini-2.5-pro': { input: 1.25, output: 10.00 },
	'gemini-2.5-flash': { input: 0.30, output: 2.50 },
	'gemini-2.5-flash-lite': { input: 0.075, output: 0.30 },
	'gemini-2.0-flash': { input: 0.10, output: 0.40 },
	'gemini-2.0-flash-lite': { input: 0.075, output: 0.30 },
	'gemini-1.5-pro': { input: 1.25, output: 5.00 },
	'gemini-1.5-flash': { input: 0.075, output: 0.30 },
	'gemini-1.5-flash-8b': { input: 0.0375, output: 0.15 }
}

export function calculateCost(model: string, usage: LLMUsage, provider?: string): number {
	const pricing = TOKEN_PRICING[model]
	const tokenCost = pricing
		? (usage.promptTokens / 1_000_000) * pricing.input + (usage.completionTokens / 1_000_000) * pricing.output
		: 0

	const searchCost = usage.webSearches && provider
		? (WEB_SEARCH_PRICING[provider] || 0) * usage.webSearches
		: 0

	return tokenCost + searchCost
}
