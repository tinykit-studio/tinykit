import { processors } from './component.js'

export async function processCode({
	component,
	head = { code: '', data: {} },
	buildStatic = true,
	format = 'esm',
	hydrated = true,
	dev_mode = false,
	sourcemap = false,
	runtime = [],
	tinykit_modules = {}
}: {
	component: string | {
		head?: string
		html?: string
		css?: string
		js?: string
		data?: object
	}
	head?: { code: string; data: object }
	buildStatic?: boolean
	format?: 'esm'
	hydrated?: boolean
	dev_mode?: boolean
	sourcemap?: boolean
	runtime?: string[]
	tinykit_modules?: { content?: object; design?: object; data?: object }
}) {
	// If component is a string, pass it directly
	if (typeof component === 'string') {
		const res = await processors.html({
			component,
			head,
			buildStatic,
			css: 'injected',
			format,
			dev_mode,
			sourcemap,
			hydrated,
			runtime,
			tinykit_modules
		})
		return res
	}

	// Handle component object
	let css = ''
	if (component.css) {
		try {
			css = await processCSS(component.css || '')
		} catch (error) {
			return {
				error: formatCssCompilationError(error)
			}
		}
	}

	const res = await processors.html({
		component: {
			...component,
			css
		},
		head,
		buildStatic,
		css: 'injected',
		format,
		dev_mode,
		sourcemap,
		hydrated,
		runtime,
		tinykit_modules
	})
	return res
}

const css_cache = new Map()
let requesting = new Set()

export class CssCompilationError extends Error {
	constructor(message: string, details: Record<string, any> = {}) {
		super(message)
		this.name = 'CssCompilationError'
		Object.assign(this, details)
	}
}

function toCssCompilationError(error: any): CssCompilationError {
	if (error instanceof CssCompilationError) return error

	const message = typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : 'Unknown CSS compilation error'

	const details: Record<string, any> = {}
	if (error && typeof error === 'object') {
		if ('line' in error && typeof error.line === 'number') {
			details.line = error.line
		}
		if ('column' in error && typeof error.column === 'number') {
			details.column = error.column
		}
		if ('reason' in error && typeof error.reason === 'string') {
			details.reason = error.reason
		}
	}

	return new CssCompilationError(message, details)
}

export async function processCSS(raw: string): Promise<string> {
	if (css_cache.has(raw)) {
		return css_cache.get(raw)
	} else if (requesting.has(raw)) {
		while (requesting.has(raw)) {
			await new Promise((resolve) => setTimeout(resolve, 25))
		}
		if (css_cache.has(raw)) {
			return css_cache.get(raw)
		}
	}

	let res: any
	try {
		requesting.add(raw)
		res = (await processors.css(raw)) || {}
	} catch (error) {
		throw toCssCompilationError(error)
	} finally {
		requesting.delete(raw)
	}

	if (!res) {
		return ''
	}

	if (res.error) {
		throw toCssCompilationError(res.error)
	}

	if (res.css) {
		css_cache.set(raw, res.css)
		return res.css
	}

	return ''
}

function formatCssCompilationError(error: any): string {
	const baseMessage =
		typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : 'Unknown CSS compilation error'

	if (!error || typeof error !== 'object') {
		return `CSS Error: ${baseMessage}`
	}

	const positions: string[] = []
	if ('line' in error && typeof error.line === 'number') {
		positions.push(`line ${error.line}`)
	}
	if ('column' in error && typeof error.column === 'number') {
		positions.push(`column ${error.column}`)
	}

	const suffix = positions.length ? ` (${positions.join(', ')})` : ''

	return `CSS Error: ${baseMessage}${suffix}`
}
