export type LLMProvider = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'openai-compatible'

export interface LLMSettings {
	provider: LLMProvider
	api_key: string
	model: string
	base_url?: string
}

export function normalize_base_url(value?: string | null): string | undefined {
	if (!value?.trim()) return undefined
	const url = new URL(value.trim())
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
		throw new Error('Use an HTTP or HTTPS base URL without credentials, query parameters, or a fragment.')
	}
	return url.toString().replace(/\/+$/, '')
}

export function endpoint_for(settings: Pick<LLMSettings, 'provider' | 'base_url'>): string | undefined {
	return normalize_base_url(settings.base_url) || (settings.provider === 'deepseek' ? 'https://api.deepseek.com' : undefined)
}

export function allows_no_key(settings: Pick<LLMSettings, 'provider' | 'base_url'>): boolean {
	return (settings.provider === 'openai-compatible' || settings.provider === 'openai') && !!normalize_base_url(settings.base_url)
}

export function is_configured(settings?: LLMSettings | null): boolean {
	if (!settings?.model?.trim()) return false
	try {
		if (!['openai', 'anthropic', 'gemini', 'deepseek', 'openai-compatible'].includes(settings.provider)) return false
		if (settings.provider === 'openai-compatible' && !normalize_base_url(settings.base_url)) return false
		return !!settings.api_key?.trim() || allows_no_key(settings)
	} catch { return false }
}

// An omitted key means keep it only for the same provider and endpoint.
// An explicit empty string clears it for servers that need no authentication.
export function merge_settings(value: LLMSettings, existing?: LLMSettings): LLMSettings {
	const base_url = normalize_base_url(value.base_url)
	const same_endpoint = existing?.provider === value.provider && endpoint_for(existing) === endpoint_for(value)
	const api_key = Object.hasOwn(value, 'api_key') ? (value.api_key || '').trim() : same_endpoint ? existing?.api_key || '' : ''
	const result = { provider: value.provider, model: value.model?.trim(), base_url, api_key }
	if (!is_configured(result)) throw new Error('Choose a provider and model, and supply its API key or a custom server URL.')
	return result
}

export function settings_from_env(env: Record<string, string | undefined>): LLMSettings | null {
	if (!env.LLM_API_KEY && !env.LLM_BASE_URL) return null
	const provider = (env.LLM_PROVIDER || 'anthropic') as LLMProvider
	const defaults: Record<string, string> = { openai: 'gpt-4o', anthropic: 'claude-sonnet-4-20250514', gemini: 'gemini-2.5-flash', deepseek: 'deepseek-flash' }
	return { provider, api_key: env.LLM_API_KEY || '', model: env.LLM_MODEL || defaults[provider] || '', base_url: env.LLM_BASE_URL || undefined }
}
