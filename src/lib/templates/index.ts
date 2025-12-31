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

// Import JSON templates (featured kits only)

// launch - Ship your ideas
import waitlist from './waitlist.json'
import voting_board from './voting-board.json'
import changelog from './changelog.json'
import landing_page from './landing-page.json'

// personal-site - Your corner of the web
import linktree from './linktree.json'
import homepage from './homepage.json'
import now_page from './now-page.json'
import micro_blog from './micro-blog.json'
import guestbook from './guestbook.json'

// daily - Simple tools for everyday
import habits from './habits.json'
import habit_dashboard from './habit-dashboard.json'
import recipes from './recipes.json'
import meal_planner from './meal-planner.json'
import goal_tracker from './goal-tracker.json'

// Productivity
import kanban from './kanban.json'
import notes from './notes.json'
import canvas from './canvas.json'
import timer from './timer.json'
import voice_memo from './voice-memo.json'
import projects from './projects.json'
import collab_board from './collab-board.json'
import ticket_tracker from './ticket-tracker.json'

// Finance
import expense from './expense.json'
import invoice from './invoice.json'

// Freelance
import proposal from './proposal.json'
import contract from './contract.json'
import time_tracker from './time-tracker.json'
import rate_calculator from './rate-calculator.json'
import portfolio from './portfolio.json'
import testimonials from './testimonials.json'
import client_crm from './client-crm.json'

// Creator
import dev_blog from './dev-blog.json'
import content_calendar from './content-calendar.json'
import media_kit from './media-kit.json'
import sponsor_deck from './sponsor-deck.json'
import merch_store from './merch-store.json'
import analytics_dashboard from './analytics-dashboard.json'

// Developer
import hn_reader from './hn-reader.json'
import status_page from './status-page.json'
import product_docs from './product-docs.json'
import personal_wiki from './personal-wiki.json'

// Social
import poll from './poll.json'

// Template type
export type Template = {
	id: string
	name: string
	description: string
	preview: string
	tags?: string[]
	kits?: string[]
	archetype?: 'site' | 'app' | 'form'
	frontend_code: string
	design: DesignField[]
	content: ContentField[]
	data?: Record<string, {
		schema: Array<{ name: string; type: string }>
		records?: Array<Record<string, any>>
		icon?: string
	}>
}

// Kit definitions
export type Kit = {
	id: string
	name: string
	tagline: string
	icon: string
	featured?: boolean
}

export type KitWithTemplates = Kit & {
	templates: Template[]
}

// All kits (featured ones shown in UI)
export const KITS: Kit[] = [
	// Tier 1: Core creators & builders
	{
		id: 'launch',
		name: 'launchkit',
		tagline: 'Ship your ideas',
		icon: 'mdi:rocket-launch',
		featured: true
	},
	{
		id: 'freelance',
		name: 'freelancekit',
		tagline: 'Run your solo business',
		icon: 'mdi:briefcase-account',
		featured: true
	},
	{
		id: 'business',
		name: 'bizkit',
		tagline: 'Run your business',
		icon: 'mdi:desk',
		featured: true
	},
	// Tier 2: Growth & audience
	{
		id: 'creator',
		name: 'creatorkit',
		tagline: 'Build your audience',
		icon: 'mdi:creation',
		featured: true
	},
	{
		id: 'developer',
		name: 'devkit',
		tagline: 'Build in public',
		icon: 'mdi:code-braces',
		featured: true
	},
	{
		id: 'personal-site',
		name: 'sitekit',
		tagline: 'Your corner of the web',
		icon: 'mdi:home-outline',
		featured: true
	},
	{
		id: 'daily',
		name: 'dailykit',
		tagline: 'Everyday rituals',
		icon: 'mdi:calendar-check-outline',
		featured: true
	}
]

// Featured kits only (for main UI)
export const FEATURED_KITS = KITS.filter(k => k.featured)

// All templates (each defines its own kit memberships via `kits` array)
export const TEMPLATES: Template[] = [
	// launch
	{ ...waitlist, archetype: 'form' } as Template,
	{ ...voting_board, archetype: 'app' } as Template,
	{ ...changelog, archetype: 'site' } as Template,
	{ ...landing_page, archetype: 'site' } as Template,
	// personal-site
	{ ...linktree, archetype: 'site' } as Template,
	{ ...homepage, archetype: 'site' } as Template,
	{ ...now_page, archetype: 'site' } as Template,
	{ ...micro_blog, archetype: 'app' } as Template,
	{ ...guestbook, archetype: 'app' } as Template,
	// daily
	{ ...habits, archetype: 'app' } as Template,
	{ ...habit_dashboard, archetype: 'app' } as Template,
	{ ...recipes, archetype: 'app' } as Template,
	{ ...meal_planner, archetype: 'app' } as Template,
	{ ...goal_tracker, archetype: 'app' } as Template,
	// productivity
	{ ...kanban, archetype: 'app' } as Template,
	{ ...notes, archetype: 'app' } as Template,
	{ ...canvas, archetype: 'app' } as Template,
	{ ...timer, archetype: 'app' } as Template,
	{ ...voice_memo, archetype: 'app' } as Template,
	{ ...projects, archetype: 'app' } as Template,
	{ ...collab_board, archetype: 'app' } as Template,
	{ ...ticket_tracker, archetype: 'app' } as Template,
	// finance
	{ ...expense, archetype: 'app' } as Template,
	{ ...invoice, archetype: 'app' } as Template,
	// freelance
	{ ...proposal, archetype: 'site' } as Template,
	{ ...contract, archetype: 'site' } as Template,
	{ ...time_tracker, archetype: 'app' } as Template,
	{ ...rate_calculator, archetype: 'app' } as Template,
	{ ...portfolio, archetype: 'site' } as Template,
	{ ...testimonials, archetype: 'site' } as Template,
	{ ...client_crm, archetype: 'app' } as Template,
	// creator
	{ ...dev_blog, archetype: 'app' } as Template,
	{ ...content_calendar, archetype: 'app' } as Template,
	{ ...media_kit, archetype: 'site' } as Template,
	{ ...sponsor_deck, archetype: 'site' } as Template,
	{ ...merch_store, archetype: 'app' } as Template,
	{ ...analytics_dashboard, archetype: 'app' } as Template,
	// developer
	{ ...hn_reader, archetype: 'app' } as Template,
	{ ...status_page, archetype: 'site' } as Template,
	{ ...product_docs, archetype: 'site' } as Template,
	{ ...personal_wiki, archetype: 'app' } as Template,
	// social
	{ ...poll, archetype: 'form' } as Template
]

// Get templates for a specific kit
export function get_templates_for_kit(kit_id: string): Template[] {
	return TEMPLATES.filter(t => t.kits?.includes(kit_id))
}

// Alias for backwards compatibility
export const get_templates_by_kit = get_templates_for_kit

// Get a template by ID
export function get_template(id: string): Template | undefined {
	return TEMPLATES.find(t => t.id === id)
}

// Get featured kits with their templates
export function get_featured_kits_with_templates(): KitWithTemplates[] {
	return FEATURED_KITS.map(kit => ({
		...kit,
		templates: get_templates_for_kit(kit.id)
	}))
}

// Get all templates grouped by kit
export function get_all_kits_with_templates(): KitWithTemplates[] {
	return KITS.map(kit => ({
		...kit,
		templates: get_templates_for_kit(kit.id)
	}))
}

// List all templates (for API endpoint)
export function list_templates(): Template[] {
	return TEMPLATES
}
