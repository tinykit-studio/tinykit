// Shared types for tinykit admin interface

// Project type (matches Pocketbase _tk_projects collection)
export type Project = {
	id: string
	name: string
	domain: string
	frontend_code: string
	backend_code: string
	published_html: string
	design: DesignField[]
	content: ContentField[]
	snapshots: Snapshot[]
	agent_chat: Message[]
	custom_instructions: string
	data: Record<string, any>
	settings: ProjectSettings
	created: string
	updated: string
}

export type ProjectSettings = {
	vibe_zone_enabled?: boolean
	project_title?: string
	domain?: string
}

// Tab IDs
export type TabId = "agent" | "code" | "content" | "design" | "data" | "history" | "config"

// Preview position
export type PreviewPosition = "right" | "left" | "bottom"

// Agent/Chat types
export type Message = {
	role: "user" | "assistant"
	content: string
	usage?: TokenUsage | null
}

// Token usage and cost tracking
export type TokenUsage = {
	model: string
	promptTokens: number
	completionTokens: number
	totalTokens: number
	cost: number
}

// File types
export type FileTreeItem = {
	name: string
	path: string
	type: "file" | "directory"
	children?: FileTreeItem[]
}

export type EditorLanguage = "javascript" | "typescript" | "html" | "css" | "json" | "markdown" | "svelte"

// Config types
export type ConfigSubTab = "env" | "endpoints"

export type ApiEndpoint = {
	id: string
	name: string
	url: string
	method: string
	headers: Record<string, string>
	proxy?: boolean
}

// Content field types
export type ContentField = {
	id: string
	name: string
	type: string
	value: any
	description: string
	customType?: string
	config?: any
}

// Design types - CSS value types
export type DesignFieldType = "color" | "size" | "font" | "radius" | "shadow" | "text"

export type DesignField = {
	id: string
	name: string
	css_var: string
	value: string
	type: DesignFieldType
	description?: string
	// Config for size/radius fields
	unit?: "px" | "rem" | "em" | "%"
	min?: number
	max?: number
	step?: number
}

// Data types
export type DataFile = string // filename

export type DataRecord = Record<string, any>

// Collection schema type (for snapshots)
export type CollectionSchema = {
	name: string
	schema: Array<{ name: string; type: string }>
	records?: Array<Record<string, any>>
}

// History/Snapshot types
export type Snapshot = {
	id: string
	timestamp: number
	description: string
	file_count: number
	// Collection schemas (added to snapshots for restore)
	collections?: CollectionSchema[]
}

// Preview/Console types
export type PreviewError = {
	type: string
	message: string
	source?: string
	line?: number
	timestamp: number
}

// Editor state snapshot (for preserving scroll position)
export type EditorSnapshot = {
	scroll_top: number
}

// Template types
export type Template = {
	id: string
	name: string
	description: string
	tags?: string[]
}

// Pending prompt type (for fix error, etc.)
// display: shown to user in chat
// full: sent to API (may include extra instructions)
export type PendingPrompt = {
	display: string
	full: string
}
