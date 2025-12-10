import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'fs/promises';
import path from 'path';
import { validateUserToken, unauthorizedResponse } from '$lib/server/pb';

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(process.cwd(), 'workspace');
const CONFIG_FILE = path.join(WORKSPACE_DIR, 'data/.crud-config.json');

// Load environment variables from config
async function loadEnvVars(): Promise<Record<string, string>> {
	try {
		const content = await fs.readFile(CONFIG_FILE, 'utf-8');
		const config = JSON.parse(content);
		return config.env || {};
	} catch (err) {
		return {};
	}
}

export const POST: RequestHandler = async ({ request }) => {
	// Require authentication
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	try {
		const body = await request.json();
		const { prompt, model = 'gpt-4o-mini', provider = 'openai', systemPrompt } = body;

		if (!prompt) {
			throw error(400, 'Prompt required');
		}

		// Load API keys from config
		const env = await loadEnvVars();

		// Build messages array
		const messages = [];
		if (systemPrompt) {
			messages.push({ role: 'system', content: systemPrompt });
		}
		messages.push({ role: 'user', content: prompt });

		let apiKey: string | undefined;
		let response: Response;

		// Determine provider and get API key
		if (provider === 'openai' || model.startsWith('gpt-')) {
			apiKey = env.OPENAI_API_KEY;
			if (!apiKey) {
				throw error(400, 'OPENAI_API_KEY not configured. Add it in Config → Environment Variables');
			}

			response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model,
					messages,
					stream: false
				})
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error?.message || 'OpenAI API error');
			}

			const data = await response.json();
			const content = data.choices?.[0]?.message?.content || '';

			return new Response(JSON.stringify({
				content,
				model,
				provider: 'openai'
			}), {
				headers: { 'Content-Type': 'application/json' }
			});

		} else if (provider === 'anthropic' || model.startsWith('claude-')) {
			apiKey = env.ANTHROPIC_API_KEY;
			if (!apiKey) {
				throw error(400, 'ANTHROPIC_API_KEY not configured. Add it in Config → Environment Variables');
			}

			const userMessages = messages.filter(m => m.role !== 'system');
			const system = systemPrompt || undefined;

			response = await fetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01'
				},
				body: JSON.stringify({
					model,
					max_tokens: 4096,
					system,
					messages: userMessages
				})
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error?.message || 'Anthropic API error');
			}

			const data = await response.json();
			const content = data.content?.[0]?.text || '';

			return new Response(JSON.stringify({
				content,
				model,
				provider: 'anthropic'
			}), {
				headers: { 'Content-Type': 'application/json' }
			});

		} else {
			throw error(400, 'Unsupported provider. Use "openai" or "anthropic"');
		}
	} catch (err: any) {
		console.error('AI Complete error:', err);
		throw error(500, err.message || 'Failed to process completion request');
	}
};
