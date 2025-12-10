// Theme definitions for the tinykit builder interface
import { writable } from 'svelte/store'

export interface BuilderTheme {
	id: string
	name: string
	colors: {
		bg_primary: string
		bg_secondary: string
		bg_tertiary: string
		accent: string
		text_primary: string
		text_secondary: string
		border: string
	}
}

// Store to track current theme for reactive components (like CodeMirror)
export const current_builder_theme = writable<BuilderTheme | null>(null)

export const builder_themes: BuilderTheme[] = [
	{
		id: 'tinykit',
		name: 'tinykit',
		colors: {
			bg_primary: '#0d0d0d',
			bg_secondary: '#1e1e1e',
			bg_tertiary: '#2a2a2a',
			accent: '#22c55e',
			text_primary: '#ffffff',
			text_secondary: '#999999',
			border: '#2a2a2a'
		}
	},
	{
		id: 'ocean',
		name: 'Ocean',
		colors: {
			bg_primary: '#0f172a',
			bg_secondary: '#1e293b',
			bg_tertiary: '#334155',
			accent: '#0ea5e9',
			text_primary: '#f1f5f9',
			text_secondary: '#94a3b8',
			border: '#334155'
		}
	},
	{
		id: 'forest',
		name: 'Forest',
		colors: {
			bg_primary: '#18181b',
			bg_secondary: '#27272a',
			bg_tertiary: '#3f3f46',
			accent: '#10b981',
			text_primary: '#fafafa',
			text_secondary: '#a1a1aa',
			border: '#3f3f46'
		}
	},
	{
		id: 'sunset',
		name: 'Sunset',
		colors: {
			bg_primary: '#1c1917',
			bg_secondary: '#292524',
			bg_tertiary: '#44403c',
			accent: '#f97316',
			text_primary: '#fafaf9',
			text_secondary: '#a8a29e',
			border: '#44403c'
		}
	},
	{
		id: 'nord',
		name: 'Nord',
		colors: {
			bg_primary: '#2e3440',
			bg_secondary: '#3b4252',
			bg_tertiary: '#434c5e',
			accent: '#88c0d0',
			text_primary: '#eceff4',
			text_secondary: '#d8dee9',
			border: '#434c5e'
		}
	},
	{
		id: 'dracula',
		name: 'Dracula',
		colors: {
			bg_primary: '#282a36',
			bg_secondary: '#44475a',
			bg_tertiary: '#6272a4',
			accent: '#ff79c6',
			text_primary: '#f8f8f2',
			text_secondary: '#a0a0a0',
			border: '#44475a'
		}
	},
	{
		id: 'tokyo',
		name: 'Tokyo Night',
		colors: {
			bg_primary: '#1a1b26',
			bg_secondary: '#24283b',
			bg_tertiary: '#414868',
			accent: '#7aa2f7',
			text_primary: '#c0caf5',
			text_secondary: '#9aa5ce',
			border: '#414868'
		}
	},
	{
		id: 'light',
		name: 'Light',
		colors: {
			bg_primary: '#ffffff',
			bg_secondary: '#f8fafc',
			bg_tertiary: '#e2e8f0',
			accent: '#3b82f6',
			text_primary: '#0f172a',
			text_secondary: '#64748b',
			border: '#e2e8f0'
		}
	},
	{
		id: 'monokai',
		name: 'Monokai',
		colors: {
			bg_primary: '#272822',
			bg_secondary: '#3e3d32',
			bg_tertiary: '#49483e',
			accent: '#f92672',
			text_primary: '#f8f8f2',
			text_secondary: '#75715e',
			border: '#49483e'
		}
	},
	{
		id: 'gruvbox',
		name: 'Gruvbox',
		colors: {
			bg_primary: '#282828',
			bg_secondary: '#3c3836',
			bg_tertiary: '#504945',
			accent: '#fe8019',
			text_primary: '#ebdbb2',
			text_secondary: '#a89984',
			border: '#504945'
		}
	},
	{
		id: 'solarized',
		name: 'Solarized Dark',
		colors: {
			bg_primary: '#002b36',
			bg_secondary: '#073642',
			bg_tertiary: '#586e75',
			accent: '#268bd2',
			text_primary: '#fdf6e3',
			text_secondary: '#93a1a1',
			border: '#073642'
		}
	},
	{
		id: 'material',
		name: 'Material',
		colors: {
			bg_primary: '#263238',
			bg_secondary: '#37474f',
			bg_tertiary: '#455a64',
			accent: '#80cbc4',
			text_primary: '#eceff1',
			text_secondary: '#b0bec5',
			border: '#37474f'
		}
	},
	{
		id: 'ayu',
		name: 'Ayu Dark',
		colors: {
			bg_primary: '#0a0e14',
			bg_secondary: '#0d1017',
			bg_tertiary: '#1f2430',
			accent: '#ffb454',
			text_primary: '#b3b1ad',
			text_secondary: '#626a73',
			border: '#1f2430'
		}
	},
	{
		id: 'onedark',
		name: 'One Dark',
		colors: {
			bg_primary: '#282c34',
			bg_secondary: '#21252b',
			bg_tertiary: '#383e4a',
			accent: '#61afef',
			text_primary: '#abb2bf',
			text_secondary: '#5c6370',
			border: '#383e4a'
		}
	},
	{
		id: 'catppuccin',
		name: 'Catppuccin',
		colors: {
			bg_primary: '#1e1e2e',
			bg_secondary: '#181825',
			bg_tertiary: '#313244',
			accent: '#f5c2e7',
			text_primary: '#cdd6f4',
			text_secondary: '#6c7086',
			border: '#313244'
		}
	},
	{
		id: 'rosepine',
		name: 'Rosé Pine',
		colors: {
			bg_primary: '#191724',
			bg_secondary: '#1f1d2e',
			bg_tertiary: '#26233a',
			accent: '#ebbcba',
			text_primary: '#e0def4',
			text_secondary: '#908caa',
			border: '#26233a'
		}
	},
	// ─────────────────────────────────────────────────────────────
	// Custom themes (not ports of editor themes)
	// ─────────────────────────────────────────────────────────────
	{
		id: 'midnight',
		name: 'Midnight',
		colors: {
			bg_primary: '#0c0f14',
			bg_secondary: '#141820',
			bg_tertiary: '#1c222d',
			accent: '#d4a574',
			text_primary: '#e8e4df',
			text_secondary: '#8a8a8a',
			border: '#252b38'
		}
	},
	{
		id: 'aurora',
		name: 'Aurora',
		colors: {
			bg_primary: '#080b10',
			bg_secondary: '#0e1219',
			bg_tertiary: '#161c26',
			accent: '#56d4bc',
			text_primary: '#d4dae4',
			text_secondary: '#6b7a8f',
			border: '#1e2633'
		}
	},
	{
		id: 'ember',
		name: 'Ember',
		colors: {
			bg_primary: '#151010',
			bg_secondary: '#1e1717',
			bg_tertiary: '#2a2121',
			accent: '#e07850',
			text_primary: '#ede8e6',
			text_secondary: '#9a8f8c',
			border: '#362c2c'
		}
	},
	{
		id: 'slate',
		name: 'Slate',
		colors: {
			bg_primary: '#1a1d23',
			bg_secondary: '#22262e',
			bg_tertiary: '#2c323c',
			accent: '#5eb3d5',
			text_primary: '#e2e6ec',
			text_secondary: '#8892a2',
			border: '#363d4a'
		}
	}
]

export function apply_builder_theme(theme: BuilderTheme) {
	const root = document.documentElement
	root.style.setProperty('--builder-bg-primary', theme.colors.bg_primary)
	root.style.setProperty('--builder-bg-secondary', theme.colors.bg_secondary)
	root.style.setProperty('--builder-bg-tertiary', theme.colors.bg_tertiary)
	root.style.setProperty('--builder-accent', theme.colors.accent)
	root.style.setProperty('--builder-text-primary', theme.colors.text_primary)
	root.style.setProperty('--builder-text-secondary', theme.colors.text_secondary)
	root.style.setProperty('--builder-border', theme.colors.border)

	// Update store for reactive components
	current_builder_theme.set(theme)
}

export function get_saved_theme(): BuilderTheme {
	if (typeof window === 'undefined') return builder_themes[0]

	const saved_id = localStorage.getItem('builder-theme')
	const theme = builder_themes.find(t => t.id === saved_id)
	return theme || builder_themes[0]
}

export function save_theme(theme_id: string) {
	if (typeof window === 'undefined') return
	localStorage.setItem('builder-theme', theme_id)
}
