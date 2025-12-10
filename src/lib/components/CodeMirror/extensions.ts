import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { svelte } from 'codemirror-lang-svelte'
import { abbreviationTracker, expandAbbreviation } from '@emmetio/codemirror6-plugin'
import { keymap } from '@codemirror/view'

export function getLanguage(mode: string) {
	return {
		svelte: svelte(),
		html: svelte(),
		css: css(),
		javascript: javascript(),
		typescript: javascript({ typescript: true }),
		json: javascript()
	}[mode] || svelte()
}

export function getEmmetExtensions(mode: string) {
	// Emmet only for HTML-like modes (Svelte templates)
	const emmet_modes = ['svelte', 'html']
	if (!emmet_modes.includes(mode)) {
		return []
	}

	return [
		abbreviationTracker(),
		keymap.of([{
			key: 'Tab',
			run: expandAbbreviation
		}])
	]
}
