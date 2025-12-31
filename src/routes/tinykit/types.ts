// Shared types for tinykit admin interface

// Kit type (matches Pocketbase _tk_kits collection)
export type Kit = {
	id: string
	name: string
	icon: string
	builder_theme_id?: string
	created: string
	updated: string
}

// Project type (matches Pocketbase _tk_projects collection)
export type Project = {
	id: string
	collectionId?: string
	name: string
	domain?: string
	kit: string
	frontend_code: string
	backend_code: string
	published_html: string
	assets: string[]
	design: DesignField[]
	content: ContentField[]
	snapshots: Snapshot[]
	agent_chat: AgentMessage[]
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
	builder_theme_id?: string
	// Service configurations
	services?: ServiceConfigs
}

// Service configuration types
export type ServiceConfigs = {
	ai?: AIServiceConfig
	email?: EmailServiceConfig
	payments?: PaymentsServiceConfig
	secrets?: SecretsServiceConfig
}

export type AIServiceConfig = {
	provider: "tinykit" | "byok"
	openai_key?: string
	allow_client: boolean
	require_login: boolean
	rate_limit: number
}

export type EmailServiceConfig = {
	provider: "resend" | "sendgrid"
	api_key?: string
	from_address?: string
}

export type PaymentsServiceConfig = {
	mode: "test" | "live"
	secret_key?: string
	webhook_secret?: string
	allow_checkout: boolean
}

export type SecretsServiceConfig = {
	variables: Array<{ key: string; value: string }>
}

// Tab IDs
export type TabId = "agent" | "code" | "content" | "design" | "data" | "history"

// Preview position
export type PreviewPosition = "right" | "left" | "bottom"

// Agent/Chat types
export type ToolCall = {
	name: string
	args?: Record<string, any>
	result?: string
}

export type StreamItem =
	| { type: 'text'; content: string }
	| { type: 'tool'; name: string; args?: Record<string, any>; result?: string }

export type AgentMessage = {
	role: "user" | "assistant"
	content: string // For user messages, or full text for completed assistant messages
	stream_items?: StreamItem[] // For assistant messages: ordered list of text chunks and tool calls
	tool_calls?: ToolCall[] // Legacy: still used for backwards compat
	usage?: TokenUsage | null
	status?: 'running' | 'complete' | 'error' // For assistant messages: streaming status
	timestamp?: number
}

// Token usage and cost tracking
export type TokenUsage = {
	model: string
	promptTokens: number
	completionTokens: number
	totalTokens: number
	cost: number
	duration?: number // seconds
}

// File types
export type FileTreeItem = {
	name: string
	path: string
	type: "file" | "directory"
	children?: FileTreeItem[]
}

// API endpoint type (placeholder for future backend API routing)
export type ApiEndpoint = {
	id: string
	path: string
	method: "GET" | "POST" | "PUT" | "DELETE"
	handler: string
}

export type EditorLanguage = "javascript" | "typescript" | "html" | "css" | "json" | "markdown" | "svelte"



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

// Data field types for collection schemas
export type DataFieldType = 'text' | 'number' | 'boolean' | 'date' | 'file' | 'files' | 'json'

// Collection schema type (for snapshots)
export type CollectionSchema = {
	name: string
	schema: Array<{ name: string; type: DataFieldType }>
	records?: Array<Record<string, any>>
	icon?: string
}

// History/Snapshot types
export type Snapshot = {
	id: string
	timestamp: number
	description: string
	// Tool calls that created this snapshot (e.g., ['write_code', 'create_design_field'])
	tools?: string[]
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
