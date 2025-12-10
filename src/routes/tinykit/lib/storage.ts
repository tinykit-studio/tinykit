// Storage helpers for tinykit admin interface
import type { Message } from "../types"

const MESSAGES_KEY = "agent-messages"

// Messages storage
export function load_messages(): Message[] {
	if (typeof window === "undefined") return []

	try {
		const saved = localStorage.getItem(MESSAGES_KEY)
		if (saved) {
			return JSON.parse(saved)
		}
	} catch (e) {
		console.error("Failed to load messages from localStorage:", e)
	}
	return []
}

export function save_messages(messages: Message[]): void {
	if (typeof window === "undefined") return
	localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages))
}

export function clear_messages(): void {
	if (typeof window === "undefined") return
	localStorage.removeItem(MESSAGES_KEY)
}

// Vibe zone preference (stored in localStorage as UI preference)
const VIBE_ZONE_KEY = "vibe-zone-enabled"

export async function load_vibe_zone_enabled(): Promise<boolean> {
	if (typeof window === "undefined") return true

	try {
		const saved = localStorage.getItem(VIBE_ZONE_KEY)
		if (saved !== null) {
			return saved === "true"
		}
	} catch (e) {
		console.error("Failed to load vibe_zone_enabled:", e)
	}
	return true // Default ON for new users
}

export async function save_vibe_zone_enabled(enabled: boolean): Promise<void> {
	if (typeof window === "undefined") return

	try {
		localStorage.setItem(VIBE_ZONE_KEY, String(enabled))
	} catch (e) {
		console.error("Failed to save vibe_zone_enabled:", e)
	}
}

// Note: Project title is now managed via the SDK directly through project_service
// See src/lib/services/project.svelte.ts for project CRUD operations
