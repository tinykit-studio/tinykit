// @ts-nocheck
import { compile } from 'svelte/compiler'

// Runs inside the rollup worker. Some embedded browsers (e.g. the Claude desktop
// app's browser pane) cannot start a URL-based worker from inside another worker,
// so compiling in a nested worker left the preview stuck on "building".
export function compile_svelte({ code, svelteOptions }) {
	try {
		// Always enable sourcemaps for better debugging
		const res = compile(code, {
			...svelteOptions,
			enableSourcemap: true
		})
		return {
			code: res?.js?.code,
			map: res?.js?.map,
			warnings: res.warnings.map((w) => ({
				message: w.message,
				code: w.code,
				start: w.start,
				frame: w.frame
			}))
		}
	} catch (error) {
		// Return structured error with all details the compiler provides
		return {
			error: {
				message: error.message,
				code: error.code,
				start: error.start,
				frame: error.frame
			}
		}
	}
}
