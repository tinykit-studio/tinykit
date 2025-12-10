/**
 * Symbols Registry API
 *
 * Endpoints for managing custom fields, elements, and plugins
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	loadRegistry,
	refreshRegistry,
	getSymbol,
	getSymbolsByType
} from '$lib/symbols-registry';
import type { SymbolType } from '$lib/types/custom-fields';
import { validateUserToken, unauthorizedResponse } from '$lib/server/pb';

/**
 * GET /api/symbols
 * Returns the full symbols registry
 *
 * Query params:
 *   ?type=field|element|plugin - Filter by symbol type
 *   ?refresh=true - Refresh registry before returning
 */
export const GET: RequestHandler = async ({ url, request }) => {
	// Require authentication
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	const typeParam = url.searchParams.get('type') as SymbolType | null;
	const shouldRefresh = url.searchParams.get('refresh') === 'true';

	try {
		// Refresh if requested
		const registry = shouldRefresh ? refreshRegistry() : loadRegistry();

		// Filter by type if specified
		if (typeParam) {
			if (!['field', 'element', 'plugin'].includes(typeParam)) {
				return json({ error: 'Invalid type parameter' }, { status: 400 });
			}

			const symbols = getSymbolsByType(typeParam);
			return json({
				type: typeParam,
				symbols,
				count: symbols.length
			});
		}

		// Return full registry
		return json(registry);
	} catch (error: any) {
		console.error('Error loading symbols registry:', error);
		return json({
			error: 'Failed to load symbols registry',
			message: error.message
		}, { status: 500 });
	}
};

/**
 * POST /api/symbols/refresh
 * Scans workspace/components and refreshes the registry
 */
export const POST: RequestHandler = async ({ request }) => {
	// Require authentication
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	try {
		const registry = refreshRegistry();

		return json({
			success: true,
			message: 'Registry refreshed successfully',
			counts: {
				fields: registry.symbols.fields.length,
				elements: registry.symbols.elements.length,
				plugins: registry.symbols.plugins.length
			}
		});
	} catch (error: any) {
		console.error('Error refreshing registry:', error);
		return json({
			error: 'Failed to refresh registry',
			message: error.message
		}, { status: 500 });
	}
};
