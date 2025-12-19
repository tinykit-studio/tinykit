/**
 * Template system - loads templates from JSON files
 *
 * Each template is a JSON file with:
 * - id: unique identifier
 * - name: display name
 * - description: short description
 * - preview: emoji or preview text
 * - tags: array of tags for filtering
 * - frontend_code: App Svelte code file
 * - design: array of DesignField (CSS variables)
 * - content: array of ContentField (CMS values)
 * - data: collection schemas (optional)
 */

import type { DesignField, ContentField } from '../../routes/tinykit/types'

// Import JSON templates
// Productivity
import kanban from './kanban.json'
import notes from './notes.json'
import canvas from './canvas.json'
import timer from './timer.json'
// Finance
import expense from './expense.json'
import invoice from './invoice.json'
// Content
import bookmarks from './bookmarks.json'
import recipes from './recipes.json'
import dev_blog from './dev-blog.json'
// Social
import linktree from './linktree.json'
import poll from './poll.json'
// News
import hn_reader from './hn-reader.json'
import rss_reader from './rss-reader.json'
import event_rsvp from './event-rsvp.json'
import client_crm from './client-crm.json'
// Marketing
import landing_page from './landing-page.json'
// Audio
import voice_memo from './voice-memo.json'

// Collection data structure
export interface CollectionSchema {
	schema: Array<{ name: string; type: string }>
	records: any[]
}

export interface Template {
	id: string
	name: string
	description: string
	preview: string
	tags: string[]
	frontend_code: string
	design: DesignField[]
	content: ContentField[]
	data?: Record<string, CollectionSchema>
}

// All templates in display order (grouped by category)
export const TEMPLATES: Template[] = [
	// Productivity
	kanban as Template,
	notes as Template,
	canvas as Template,
	timer as Template,
	voice_memo as Template,
	// Finance
	expense as Template,
	invoice as Template,
	// Content
	bookmarks as Template,
	recipes as Template,
	landing_page as Template,
	dev_blog as Template,
	// Social
	linktree as Template,
	poll as Template,
	event_rsvp as Template,
	// Business
	client_crm as Template,
	// News
	hn_reader as Template,
	rss_reader as Template
]

// Get template by ID
export function get_template(id: string): Template | undefined {
	return TEMPLATES.find(t => t.id === id)
}

// List all templates (summary info only)
export function list_templates(): Pick<Template, 'id' | 'name' | 'description' | 'preview' | 'tags'>[] {
	return TEMPLATES.map(t => ({
		id: t.id,
		name: t.name,
		description: t.description,
		preview: t.preview,
		tags: t.tags
	}))
}
