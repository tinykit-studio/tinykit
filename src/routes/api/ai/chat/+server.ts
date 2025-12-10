import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'fs/promises';
import path from 'path';
import { env } from '$env/dynamic/private';
import { validateUserToken, unauthorizedResponse } from '$lib/server/pb';

const WORKSPACE_DIR = env.WORKSPACE_DIR || path.join(process.cwd(), 'workspace');
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

// OpenAI Chat Completion
async function callOpenAI(messages: any[], model: string, apiKey: string, stream: boolean) {
	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${apiKey}`
		},
		body: JSON.stringify({
			model,
			messages,
			stream
		})
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({}));
		throw new Error(errorData.error?.message || 'OpenAI API error');
	}

	return response;
}

// Anthropic Chat Completion
async function callAnthropic(messages: any[], model: string, apiKey: string, stream: boolean) {
	// Convert OpenAI format to Anthropic format
	const systemMessage = messages.find(m => m.role === 'system');
	const userMessages = messages.filter(m => m.role !== 'system');

	const response = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01'
		},
		body: JSON.stringify({
			model,
			max_tokens: 4096,
			system: systemMessage?.content || undefined,
			messages: userMessages,
			stream
		})
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({}));
		throw new Error(errorData.error?.message || 'Anthropic API error');
	}

	return response;
}

export const POST: RequestHandler = async ({ request }) => {
	// Require authentication
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	try {
		const body = await request.json();
		const { messages, model = 'gpt-4o-mini', provider = 'openai', stream = false } = body;

		if (!messages || !Array.isArray(messages)) {
			throw error(400, 'Messages array required');
		}

		// Load API keys from config
		const env = await loadEnvVars();

		let apiKey: string | undefined;
		let response: Response;

		// Determine provider and get API key
		if (provider === 'openai' || model.startsWith('gpt-')) {
			apiKey = env.OPENAI_API_KEY;
			if (!apiKey) {
				throw error(400, 'OPENAI_API_KEY not configured. Add it in Config → Environment Variables');
			}
			response = await callOpenAI(messages, model, apiKey, stream);
		} else if (provider === 'anthropic' || model.startsWith('claude-')) {
			apiKey = env.ANTHROPIC_API_KEY;
			if (!apiKey) {
				throw error(400, 'ANTHROPIC_API_KEY not configured. Add it in Config → Environment Variables');
			}
			response = await callAnthropic(messages, model, apiKey, stream);
		} else {
			throw error(400, 'Unsupported provider. Use "openai" or "anthropic"');
		}

		// Return streaming or non-streaming response
		if (stream) {
			return new Response(response.body, {
				headers: {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					'Connection': 'keep-alive'
				}
			});
		} else {
			const data = await response.json();

			// Normalize response format
			let content = '';
			if (provider === 'openai' || model.startsWith('gpt-')) {
				content = data.choices?.[0]?.message?.content || '';
			} else if (provider === 'anthropic' || model.startsWith('claude-')) {
				content = data.content?.[0]?.text || '';
			}

			return new Response(JSON.stringify({
				content,
				model,
				provider,
				raw: data
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		}
	} catch (err: any) {
		console.error('AI Chat error:', err);
		throw error(500, err.message || 'Failed to process chat request');
	}
};
