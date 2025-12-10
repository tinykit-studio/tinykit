// @ts-nocheck
import registerPromiseWorker from 'promise-worker/register'
import { compile as svelte_compile } from 'svelte/compiler'

registerPromiseWorker(async function ({ code, svelteOptions }) {
	try {
		// Always enable sourcemaps for better debugging
		const res = svelte_compile(code, {
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
})
