import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// Get CSS variable or fallback
function get_css_var(name: string, fallback: string): string {
	if (typeof window === 'undefined') return fallback
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

// Helper to lighten a hex color slightly (2.5% white overlay)
function lighten_bg(hexColor: string): string {
	// Remove # if present
	const hex = hexColor.replace('#', '')
	const r = parseInt(hex.substring(0, 2), 16)
	const g = parseInt(hex.substring(2, 4), 16)
	const b = parseInt(hex.substring(4, 6), 16)

	// Mix with white at 2.5% opacity (97.5% original + 2.5% white)
	const nr = Math.round(r * 0.975 + 255 * 0.025)
	const ng = Math.round(g * 0.975 + 255 * 0.025)
	const nb = Math.round(b * 0.975 + 255 * 0.025)

	return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`
}

// Detect if current theme is light based on background luminance
function is_light_theme(): boolean {
	const bg = get_css_var('--builder-bg-primary', '#1c1c1c').replace('#', '')
	const r = parseInt(bg.substring(0, 2), 16)
	const g = parseInt(bg.substring(2, 4), 16)
	const b = parseInt(bg.substring(4, 6), 16)
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
	return luminance > 0.5
}

// Base colors with builder theme integration
const get_base_colors = () => {
	const primaryBg = get_css_var('--builder-bg-primary', '#1c1c1c')
	const isLight = is_light_theme()

	if (isLight) {
		// Light theme colors (VS Code Light-inspired)
		return {
			base00: primaryBg,
			base01: get_css_var('--builder-bg-tertiary', '#e2e8f0'),
			base02: '#e4e4e4',
			base03: '#6e7781',
			base04: '#1f2328',
			base05: get_css_var('--builder-text-primary', '#1f2328'),
			base06: '#1f2328',
			base07: get_css_var('--builder-bg-secondary', '#f8fafc'),
			base08: '#0550ae', // keywords - blue
			base09: '#8250df', // control keywords - purple
			base0A: '#953800', // variables/properties - brown/orange
			base0B: '#116329', // types/classes - green
			base0C: '#8250df', // functions - purple
			base0D: '#0550ae', // numbers - blue
			base0E: '#0a3069', // strings - dark blue
			base0F: '#cf222e', // errors - red
			base10: '#953800', // special - brown
			base11: '#6e7781', // comments - gray
			accent: get_css_var('--builder-accent', '#3b82f6'),
			isLight: true
		}
	}

	// Dark theme colors (original)
	return {
		base00: lighten_bg(primaryBg),
		base01: get_css_var('--builder-bg-tertiary', '#252526'),
		base02: '#2d2d30',
		base03: '#838383',
		base04: '#c6c6c6',
		base05: get_css_var('--builder-text-primary', '#d4d4d4'),
		base06: '#e9e9e9',
		base07: primaryBg,
		base08: '#569cd6',
		base09: '#c586c0',
		base0A: '#9cdcfe',
		base0B: '#4ec9b0',
		base0C: '#dcdcaa',
		base0D: '#b5cea8',
		base0E: '#ce9178',
		base0F: '#f44747',
		base10: '#d7ba7d',
		base11: '#6a9955',
		accent: get_css_var('--builder-accent', '#f97316'),
		isLight: false
	}
}

export function create_themed_editor() {
	const colors = get_base_colors()
	const background = colors.base00
	const isLight = 'isLight' in colors && colors.isLight
	const selection = isLight ? '#0366d625' : '#264F7899'
	const cursor = colors.base04
	const highlightBackground = isLight ? '#0000000a' : '#FFFFFF08'
	const gutterBorder = isLight ? '#e4e4e4' : '#222'
	const scrollbarThumb = isLight ? '#c1c1c1' : '#424242'
	const scrollbarThumbHover = isLight ? '#a1a1a1' : '#525252'

	const editorTheme = EditorView.theme(
		{
			'&': {
				color: colors.base05,
				backgroundColor: background,
				fontSize: '14px',
				fontFamily: 'JetBrains Mono, Monaco, Consolas, monospace'
			},
			'.cm-content': {
				caretColor: cursor,
				lineHeight: '1.6'
			},
			'.cm-cursor, .cm-dropCursor': {
				borderLeftColor: cursor,
				borderLeftWidth: '2px'
			},
			'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
				{
					backgroundColor: selection
				},
			'.cm-activeLine': {
				backgroundColor: highlightBackground,
				borderRadius: '2px'
			},
			'.cm-gutters': {
				backgroundColor: colors.base07,
				color: colors.base03,
				border: 'none',
				borderRight: `1px solid ${gutterBorder}`
			},
			'.cm-activeLineGutter': {
				backgroundColor: highlightBackground,
				color: colors.base06,
				fontWeight: '500'
			},
			'&.cm-focused': {
				outline: 'none'
			},
			'& .cm-scroller::-webkit-scrollbar': {
				width: '12px',
				height: '12px'
			},
			'& .cm-scroller::-webkit-scrollbar-track': {
				background: background
			},
			'& .cm-scroller::-webkit-scrollbar-thumb': {
				backgroundColor: scrollbarThumb,
				borderRadius: '6px',
				border: `3px solid ${background}`
			},
			'& .cm-scroller::-webkit-scrollbar-thumb:hover': {
				backgroundColor: scrollbarThumbHover
			}
		},
		{ dark: !isLight }
	)

	const highlightStyle = HighlightStyle.define([
		{ tag: tags.keyword, color: colors.base08, fontWeight: 'bold' },
		{ tag: tags.controlKeyword, color: colors.base09, fontWeight: 'bold' },
		{ tag: [tags.variableName], color: colors.base0A },
		{ tag: [tags.propertyName], color: colors.base0A },
		{ tag: [tags.typeName, tags.className], color: colors.base0B },
		{ tag: [tags.function(tags.variableName)], color: colors.base0C },
		{ tag: tags.number, color: colors.base0D },
		{ tag: tags.string, color: colors.base0E },
		{ tag: tags.comment, fontStyle: 'italic', color: colors.base11 },
		{ tag: [tags.tagName], color: colors.base08 },
		{ tag: [tags.attributeName], color: colors.base0A }
	])

	return [editorTheme, syntaxHighlighting(highlightStyle)]
}

// Default export for immediate use
export const vsCodeDark = create_themed_editor()
