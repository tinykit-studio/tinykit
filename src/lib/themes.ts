// Predefined theme definitions for tinykit builder

export interface ThemeField {
	id?: string
	name: string
	css_var: string
	value: string
	description: string
}

export interface Theme {
	id: string
	name: string
	description: string
	preview: {
		primary: string
		secondary: string
		accent: string
		background: string
	}
	fields: ThemeField[]
}

export const predefined_themes: Theme[] = [
	{
		id: 'ocean',
		name: 'Ocean',
		description: 'Cool blues and teals inspired by the sea',
		preview: {
			primary: '#0ea5e9',
			secondary: '#06b6d4',
			accent: '#8b5cf6',
			background: '#0f172a'
		},
		fields: [
			{ name: 'Primary Color', css_var: '--color-primary', value: '#0ea5e9', description: 'Main brand color' },
			{ name: 'Secondary Color', css_var: '--color-secondary', value: '#06b6d4', description: 'Supporting brand color' },
			{ name: 'Accent Color', css_var: '--color-accent', value: '#8b5cf6', description: 'Highlight color' },
			{ name: 'Background', css_var: '--color-bg', value: '#0f172a', description: 'Main background' },
			{ name: 'Surface', css_var: '--color-surface', value: '#1e293b', description: 'Card/panel background' },
			{ name: 'Text', css_var: '--color-text', value: '#f1f5f9', description: 'Primary text' },
			{ name: 'Text Muted', css_var: '--color-text-muted', value: '#94a3b8', description: 'Secondary text' },
			{ name: 'Border', css_var: '--color-border', value: '#334155', description: 'Border color' },
			{ name: 'Font Family', css_var: '--font-family', value: 'system-ui, sans-serif', description: 'Main font' },
			{ name: 'Border Radius', css_var: '--radius', value: '0.5rem', description: 'Corner roundness' },
			{ name: 'Spacing Unit', css_var: '--spacing', value: '1rem', description: 'Base spacing' }
		]
	},
	{
		id: 'sunset',
		name: 'Sunset',
		description: 'Warm oranges and pinks with golden accents',
		preview: {
			primary: '#f97316',
			secondary: '#ec4899',
			accent: '#fbbf24',
			background: '#1c1917'
		},
		fields: [
			{ name: 'Primary Color', css_var: '--color-primary', value: '#f97316', description: 'Main brand color' },
			{ name: 'Secondary Color', css_var: '--color-secondary', value: '#ec4899', description: 'Supporting brand color' },
			{ name: 'Accent Color', css_var: '--color-accent', value: '#fbbf24', description: 'Highlight color' },
			{ name: 'Background', css_var: '--color-bg', value: '#1c1917', description: 'Main background' },
			{ name: 'Surface', css_var: '--color-surface', value: '#292524', description: 'Card/panel background' },
			{ name: 'Text', css_var: '--color-text', value: '#fafaf9', description: 'Primary text' },
			{ name: 'Text Muted', css_var: '--color-text-muted', value: '#a8a29e', description: 'Secondary text' },
			{ name: 'Border', css_var: '--color-border', value: '#44403c', description: 'Border color' },
			{ name: 'Font Family', css_var: '--font-family', value: 'system-ui, sans-serif', description: 'Main font' },
			{ name: 'Border Radius', css_var: '--radius', value: '0.75rem', description: 'Corner roundness' },
			{ name: 'Spacing Unit', css_var: '--spacing', value: '1rem', description: 'Base spacing' }
		]
	},
	{
		id: 'forest',
		name: 'Forest',
		description: 'Natural greens with earthy tones',
		preview: {
			primary: '#10b981',
			secondary: '#059669',
			accent: '#84cc16',
			background: '#18181b'
		},
		fields: [
			{ name: 'Primary Color', css_var: '--color-primary', value: '#10b981', description: 'Main brand color' },
			{ name: 'Secondary Color', css_var: '--color-secondary', value: '#059669', description: 'Supporting brand color' },
			{ name: 'Accent Color', css_var: '--color-accent', value: '#84cc16', description: 'Highlight color' },
			{ name: 'Background', css_var: '--color-bg', value: '#18181b', description: 'Main background' },
			{ name: 'Surface', css_var: '--color-surface', value: '#27272a', description: 'Card/panel background' },
			{ name: 'Text', css_var: '--color-text', value: '#fafafa', description: 'Primary text' },
			{ name: 'Text Muted', css_var: '--color-text-muted', value: '#a1a1aa', description: 'Secondary text' },
			{ name: 'Border', css_var: '--color-border', value: '#3f3f46', description: 'Border color' },
			{ name: 'Font Family', css_var: '--font-family', value: 'system-ui, sans-serif', description: 'Main font' },
			{ name: 'Border Radius', css_var: '--radius', value: '0.5rem', description: 'Corner roundness' },
			{ name: 'Spacing Unit', css_var: '--spacing', value: '1rem', description: 'Base spacing' }
		]
	},
	{
		id: 'noir',
		name: 'Noir',
		description: 'Monochrome black and white with high contrast',
		preview: {
			primary: '#ffffff',
			secondary: '#a3a3a3',
			accent: '#737373',
			background: '#000000'
		},
		fields: [
			{ name: 'Primary Color', css_var: '--color-primary', value: '#ffffff', description: 'Main brand color' },
			{ name: 'Secondary Color', css_var: '--color-secondary', value: '#a3a3a3', description: 'Supporting brand color' },
			{ name: 'Accent Color', css_var: '--color-accent', value: '#737373', description: 'Highlight color' },
			{ name: 'Background', css_var: '--color-bg', value: '#000000', description: 'Main background' },
			{ name: 'Surface', css_var: '--color-surface', value: '#171717', description: 'Card/panel background' },
			{ name: 'Text', css_var: '--color-text', value: '#ffffff', description: 'Primary text' },
			{ name: 'Text Muted', css_var: '--color-text-muted', value: '#a3a3a3', description: 'Secondary text' },
			{ name: 'Border', css_var: '--color-border', value: '#262626', description: 'Border color' },
			{ name: 'Font Family', css_var: '--font-family', value: 'system-ui, sans-serif', description: 'Main font' },
			{ name: 'Border Radius', css_var: '--radius', value: '0.25rem', description: 'Corner roundness' },
			{ name: 'Spacing Unit', css_var: '--spacing', value: '1rem', description: 'Base spacing' }
		]
	},
	{
		id: 'lavender',
		name: 'Lavender',
		description: 'Soft purples and pinks for a gentle, calming feel',
		preview: {
			primary: '#a78bfa',
			secondary: '#c084fc',
			accent: '#f0abfc',
			background: '#1e1b4b'
		},
		fields: [
			{ name: 'Primary Color', css_var: '--color-primary', value: '#a78bfa', description: 'Main brand color' },
			{ name: 'Secondary Color', css_var: '--color-secondary', value: '#c084fc', description: 'Supporting brand color' },
			{ name: 'Accent Color', css_var: '--color-accent', value: '#f0abfc', description: 'Highlight color' },
			{ name: 'Background', css_var: '--color-bg', value: '#1e1b4b', description: 'Main background' },
			{ name: 'Surface', css_var: '--color-surface', value: '#312e81', description: 'Card/panel background' },
			{ name: 'Text', css_var: '--color-text', value: '#faf5ff', description: 'Primary text' },
			{ name: 'Text Muted', css_var: '--color-text-muted', value: '#c4b5fd', description: 'Secondary text' },
			{ name: 'Border', css_var: '--color-border', value: '#4c1d95', description: 'Border color' },
			{ name: 'Font Family', css_var: '--font-family', value: 'system-ui, sans-serif', description: 'Main font' },
			{ name: 'Border Radius', css_var: '--radius', value: '0.75rem', description: 'Corner roundness' },
			{ name: 'Spacing Unit', css_var: '--spacing', value: '1rem', description: 'Base spacing' }
		]
	},
	{
		id: 'retro',
		name: 'Retro',
		description: 'Vintage computing with amber and green CRT vibes',
		preview: {
			primary: '#fbbf24',
			secondary: '#84cc16',
			accent: '#22d3ee',
			background: '#1a1a1a'
		},
		fields: [
			{ name: 'Primary Color', css_var: '--color-primary', value: '#fbbf24', description: 'Main brand color' },
			{ name: 'Secondary Color', css_var: '--color-secondary', value: '#84cc16', description: 'Supporting brand color' },
			{ name: 'Accent Color', css_var: '--color-accent', value: '#22d3ee', description: 'Highlight color' },
			{ name: 'Background', css_var: '--color-bg', value: '#1a1a1a', description: 'Main background' },
			{ name: 'Surface', css_var: '--color-surface', value: '#2a2a2a', description: 'Card/panel background' },
			{ name: 'Text', css_var: '--color-text', value: '#fde68a', description: 'Primary text' },
			{ name: 'Text Muted', css_var: '--color-text-muted', value: '#bef264', description: 'Secondary text' },
			{ name: 'Border', css_var: '--color-border', value: '#404040', description: 'Border color' },
			{ name: 'Font Family', css_var: '--font-family', value: 'monospace', description: 'Main font' },
			{ name: 'Border Radius', css_var: '--radius', value: '0rem', description: 'Corner roundness' },
			{ name: 'Spacing Unit', css_var: '--spacing', value: '1rem', description: 'Base spacing' }
		]
	},
	{
		id: 'light',
		name: 'Light',
		description: 'Clean and bright with blue accents',
		preview: {
			primary: '#3b82f6',
			secondary: '#8b5cf6',
			accent: '#06b6d4',
			background: '#ffffff'
		},
		fields: [
			{ name: 'Primary Color', css_var: '--color-primary', value: '#3b82f6', description: 'Main brand color' },
			{ name: 'Secondary Color', css_var: '--color-secondary', value: '#8b5cf6', description: 'Supporting brand color' },
			{ name: 'Accent Color', css_var: '--color-accent', value: '#06b6d4', description: 'Highlight color' },
			{ name: 'Background', css_var: '--color-bg', value: '#ffffff', description: 'Main background' },
			{ name: 'Surface', css_var: '--color-surface', value: '#f8fafc', description: 'Card/panel background' },
			{ name: 'Text', css_var: '--color-text', value: '#0f172a', description: 'Primary text' },
			{ name: 'Text Muted', css_var: '--color-text-muted', value: '#64748b', description: 'Secondary text' },
			{ name: 'Border', css_var: '--color-border', value: '#e2e8f0', description: 'Border color' },
			{ name: 'Font Family', css_var: '--font-family', value: 'system-ui, sans-serif', description: 'Main font' },
			{ name: 'Border Radius', css_var: '--radius', value: '0.5rem', description: 'Corner roundness' },
			{ name: 'Spacing Unit', css_var: '--spacing', value: '1rem', description: 'Base spacing' }
		]
	},
	{
		id: 'cyberpunk',
		name: 'Cyberpunk',
		description: 'Neon pinks and blues for a futuristic vibe',
		preview: {
			primary: '#ff00ff',
			secondary: '#00ffff',
			accent: '#ffff00',
			background: '#0a0015'
		},
		fields: [
			{ name: 'Primary Color', css_var: '--color-primary', value: '#ff00ff', description: 'Main brand color' },
			{ name: 'Secondary Color', css_var: '--color-secondary', value: '#00ffff', description: 'Supporting brand color' },
			{ name: 'Accent Color', css_var: '--color-accent', value: '#ffff00', description: 'Highlight color' },
			{ name: 'Background', css_var: '--color-bg', value: '#0a0015', description: 'Main background' },
			{ name: 'Surface', css_var: '--color-surface', value: '#1a0030', description: 'Card/panel background' },
			{ name: 'Text', css_var: '--color-text', value: '#ffffff', description: 'Primary text' },
			{ name: 'Text Muted', css_var: '--color-text-muted', value: '#ff00ff', description: 'Secondary text' },
			{ name: 'Border', css_var: '--color-border', value: '#ff00ff', description: 'Border color' },
			{ name: 'Font Family', css_var: '--font-family', value: 'monospace', description: 'Main font' },
			{ name: 'Border Radius', css_var: '--radius', value: '0rem', description: 'Corner roundness' },
			{ name: 'Spacing Unit', css_var: '--spacing', value: '1rem', description: 'Base spacing' }
		]
	}
]
