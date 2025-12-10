/**
 * Font utilities for auto-injecting Bunny Fonts CDN links
 */

// System font stacks that don't need CDN loading
const SYSTEM_FONT_PATTERNS = [
	'system-ui',
	'-apple-system',
	'BlinkMacSystemFont',
	'Segoe UI',
	'Roboto', // Roboto is tricky - it's both a system font on Android and a web font
	'Helvetica',
	'Arial',
	'sans-serif',
	'serif',
	'monospace',
	'cursive',
	'fantasy',
	'ui-monospace',
	'ui-sans-serif',
	'ui-serif',
	'ui-rounded',
	'Georgia',
	'Cambria',
	'Times New Roman',
	'Times',
	'Courier New',
	'Courier',
	'Monaco',
	'Menlo',
	'Consolas',
	'Liberation Mono',
	'DejaVu Sans Mono',
	'Lucida Console',
	'SF Mono',
	'SFMono-Regular'
]

/**
 * Check if a font value is a system font that doesn't need CDN loading
 * @param {string} font_value
 * @returns {boolean}
 */
function is_system_font(font_value) {
	if (!font_value || typeof font_value !== 'string') return true

	const lower = font_value.toLowerCase()

	// Check if it's a system font stack (contains multiple fonts separated by commas)
	if (font_value.includes(',')) {
		// If it starts with system-ui or -apple-system, it's a system font stack
		const first_font = font_value.split(',')[0].trim().replace(/["']/g, '')
		if (first_font === 'system-ui' || first_font === '-apple-system') {
			return true
		}
	}

	// Check against known system fonts
	for (const pattern of SYSTEM_FONT_PATTERNS) {
		if (lower === pattern.toLowerCase()) return true
	}

	return false
}

/**
 * Convert a font name to Bunny Fonts URL format
 * @param {string} font_name - e.g. "Inter", "Open Sans", "Playfair Display"
 * @returns {string} - e.g. "inter", "open-sans", "playfair-display"
 */
function font_name_to_slug(font_name) {
	return font_name
		.toLowerCase()
		.trim()
		.replace(/\s+/g, '-')
}

/**
 * Extract unique font names from design fields that need CDN loading
 * @param {Array<{type?: string, value: string}>} design_fields
 * @returns {string[]} - Array of font names
 */
export function extract_web_fonts(design_fields) {
	if (!Array.isArray(design_fields)) return []

	const fonts = new Set()

	for (const field of design_fields) {
		// Only process font-type fields
		if (field.type !== 'font') continue

		const value = field.value
		if (!value || typeof value !== 'string') continue

		// Skip system fonts
		if (is_system_font(value)) continue

		// Add the font name (cleaned up)
		const font_name = value.trim().replace(/["']/g, '')
		if (font_name) {
			fonts.add(font_name)
		}
	}

	return Array.from(fonts)
}

/**
 * Generate Bunny Fonts CDN link tags for the given design fields
 * @param {Array<{type?: string, value: string}>} design_fields
 * @returns {string} - HTML link tags
 */
export function generate_font_links(design_fields) {
	const fonts = extract_web_fonts(design_fields)

	if (fonts.length === 0) return ''

	// Build a single combined URL for all fonts (more efficient)
	// Format: https://fonts.bunny.net/css?family=inter:400,700|open-sans:400,700
	const font_params = fonts
		.map(font => `${font_name_to_slug(font)}:400,500,600,700`)
		.join('|')

	return `<link rel="stylesheet" href="https://fonts.bunny.net/css?family=${encodeURIComponent(font_params)}&display=swap">`
}
