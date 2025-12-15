/**
 * Color utilities for generating harmonious color palettes
 * Uses OKLCH for perceptually uniform color generation
 */

import { oklch, formatHex, parse } from 'culori'

export type HSL = { h: number; s: number; l: number }

/**
 * Convert hex color to HSL
 */
export function hex_to_hsl(hex: string): HSL {
	// Remove # if present
	hex = hex.replace(/^#/, '')

	// Parse RGB
	const r = parseInt(hex.slice(0, 2), 16) / 255
	const g = parseInt(hex.slice(2, 4), 16) / 255
	const b = parseInt(hex.slice(4, 6), 16) / 255

	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const l = (max + min) / 2

	let h = 0
	let s = 0

	if (max !== min) {
		const d = max - min
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

		switch (max) {
			case r:
				h = ((g - b) / d + (g < b ? 6 : 0)) / 6
				break
			case g:
				h = ((b - r) / d + 2) / 6
				break
			case b:
				h = ((r - g) / d + 4) / 6
				break
		}
	}

	return {
		h: Math.round(h * 360),
		s: Math.round(s * 100),
		l: Math.round(l * 100)
	}
}

/**
 * Convert HSL to hex color
 */
export function hsl_to_hex(hsl: HSL): string {
	const h = hsl.h / 360
	const s = hsl.s / 100
	const l = hsl.l / 100

	let r: number, g: number, b: number

	if (s === 0) {
		r = g = b = l
	} else {
		const hue_to_rgb = (p: number, q: number, t: number) => {
			if (t < 0) t += 1
			if (t > 1) t -= 1
			if (t < 1 / 6) return p + (q - p) * 6 * t
			if (t < 1 / 2) return q
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
			return p
		}

		const q = l < 0.5 ? l * (1 + s) : l + s - l * s
		const p = 2 * l - q

		r = hue_to_rgb(p, q, h + 1 / 3)
		g = hue_to_rgb(p, q, h)
		b = hue_to_rgb(p, q, h - 1 / 3)
	}

	const to_hex = (x: number) => {
		const hex = Math.round(x * 255).toString(16)
		return hex.length === 1 ? '0' + hex : hex
	}

	return `#${to_hex(r)}${to_hex(g)}${to_hex(b)}`
}

/**
 * Generate complementary color (opposite on color wheel)
 */
export function get_complementary(hex: string): string {
	const hsl = hex_to_hsl(hex)
	return hsl_to_hex({ ...hsl, h: (hsl.h + 180) % 360 })
}

/**
 * Generate analogous colors (adjacent on color wheel)
 */
export function get_analogous(hex: string, count: number = 2): string[] {
	const hsl = hex_to_hsl(hex)
	const step = 30 // degrees apart
	const colors: string[] = []

	for (let i = 1; i <= count; i++) {
		colors.push(hsl_to_hex({ ...hsl, h: (hsl.h + step * i) % 360 }))
		colors.push(hsl_to_hex({ ...hsl, h: (hsl.h - step * i + 360) % 360 }))
	}

	return colors.slice(0, count * 2)
}

/**
 * Generate triadic colors (120° apart)
 */
export function get_triadic(hex: string): string[] {
	const hsl = hex_to_hsl(hex)
	return [
		hsl_to_hex({ ...hsl, h: (hsl.h + 120) % 360 }),
		hsl_to_hex({ ...hsl, h: (hsl.h + 240) % 360 })
	]
}

/**
 * Generate split-complementary colors
 */
export function get_split_complementary(hex: string): string[] {
	const hsl = hex_to_hsl(hex)
	return [
		hsl_to_hex({ ...hsl, h: (hsl.h + 150) % 360 }),
		hsl_to_hex({ ...hsl, h: (hsl.h + 210) % 360 })
	]
}

/**
 * Generate shades (darker versions) of a color
 */
export function get_shades(hex: string, count: number = 3): string[] {
	const hsl = hex_to_hsl(hex)
	const colors: string[] = []
	const step = Math.min(15, hsl.l / (count + 1))

	for (let i = 1; i <= count; i++) {
		colors.push(hsl_to_hex({ ...hsl, l: Math.max(5, hsl.l - step * i) }))
	}

	return colors
}

/**
 * Generate tints (lighter versions) of a color
 */
export function get_tints(hex: string, count: number = 3): string[] {
	const hsl = hex_to_hsl(hex)
	const colors: string[] = []
	const step = Math.min(15, (100 - hsl.l) / (count + 1))

	for (let i = 1; i <= count; i++) {
		colors.push(hsl_to_hex({ ...hsl, l: Math.min(95, hsl.l + step * i) }))
	}

	return colors
}

/**
 * Generate a harmonious palette from theme colors
 * Priority: theme colors first, then complementary/analogous to fill
 */
export function generate_smart_palette(
	theme_colors: string[],
	target_count: number = 24
): string[] {
	const palette: string[] = []
	const seen = new Set<string>()

	const add_color = (color: string) => {
		const normalized = color.toLowerCase()
		if (!seen.has(normalized) && palette.length < target_count) {
			seen.add(normalized)
			palette.push(normalized)
		}
	}

	// 1. Add theme colors
	for (const color of theme_colors) {
		add_color(color)
	}

	// 2. Generate harmonies from theme colors (or default blue if none)
	const base_colors = theme_colors.length > 0 ? theme_colors : ['#3b82f6']

	for (const base of base_colors) {
		if (palette.length >= target_count) break

		// Add complementary
		add_color(get_complementary(base))

		// Add analogous
		for (const c of get_analogous(base, 2)) {
			add_color(c)
		}

		// Add split-complementary
		for (const c of get_split_complementary(base)) {
			add_color(c)
		}

		// Add shades and tints
		for (const c of get_shades(base, 2)) {
			add_color(c)
		}
		for (const c of get_tints(base, 2)) {
			add_color(c)
		}
	}

	// 3. Generate varied hues using OKLCH for perceptual uniformity
	// Convert theme colors to OKLCH to extract lightness and chroma
	const theme_oklch = base_colors
		.map(c => oklch(parse(c)))
		.filter((c): c is NonNullable<typeof c> => c !== undefined)

	const avg_lightness = theme_oklch.length > 0
		? theme_oklch.reduce((sum, c) => sum + (c.l ?? 0.65), 0) / theme_oklch.length
		: 0.65
	const avg_chroma = theme_oklch.length > 0
		? theme_oklch.reduce((sum, c) => sum + (c.c ?? 0.15), 0) / theme_oklch.length
		: 0.15

	// Clamp to reasonable ranges for vibrant but not oversaturated colors
	const lightness = Math.max(0.5, Math.min(0.75, avg_lightness))
	const chroma = Math.max(0.1, Math.min(0.2, avg_chroma))

	// Generate 16 colors distributed across the hue wheel (OKLCH)
	for (let i = 0; i < 16; i++) {
		const hue = (i * 360) / 16
		const hex = formatHex({ mode: 'oklch', l: lightness, c: chroma, h: hue })
		if (hex) add_color(hex)
	}

	// 4. Add neutrals if still need more
	const neutrals = [
		'#000000', '#1a1a1a', '#333333', '#4d4d4d', '#666666',
		'#808080', '#999999', '#b3b3b3', '#cccccc', '#e6e6e6', '#ffffff'
	]

	for (const neutral of neutrals) {
		add_color(neutral)
	}

	return palette
}

/**
 * Check if a color is light or dark (for contrast decisions)
 */
export function is_light(hex: string): boolean {
	const hsl = hex_to_hsl(hex)
	return hsl.l > 50
}

/**
 * Get a contrasting text color (black or white)
 */
export function get_contrast_color(hex: string): string {
	return is_light(hex) ? '#000000' : '#ffffff'
}
