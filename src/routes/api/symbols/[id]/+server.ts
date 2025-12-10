/**
 * Individual Symbol API
 *
 * Get details for a specific symbol by ID
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSymbol } from '$lib/symbols-registry';
import { readFile } from 'fs/promises';
import { join } from 'path';

const WORKSPACE_DIR = join(process.cwd(), 'workspace');

/**
 * GET /api/symbols/[id]
 * Returns details for a specific symbol
 *
 * Query params:
 *   ?includeComponent=true - Include component source code
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const { id } = params;
	const includeComponent = url.searchParams.get('includeComponent') === 'true';

	try {
		const symbol = getSymbol(id);

		if (!symbol) {
			return json({
				error: 'Symbol not found',
				id
			}, { status: 404 });
		}

		const response: any = {
			...symbol
		};

		// Optionally include component source code
		if (includeComponent) {
			try {
				const componentPath = join(WORKSPACE_DIR, symbol.path, symbol.component);
				const componentCode = await readFile(componentPath, 'utf-8');
				response.componentCode = componentCode;
			} catch (error: any) {
				console.error(`Failed to read component file: ${error.message}`);
				response.componentCode = null;
			}
		}

		return json(response);
	} catch (error: any) {
		console.error('Error fetching symbol:', error);
		return json({
			error: 'Failed to fetch symbol',
			message: error.message
		}, { status: 500 });
	}
};
