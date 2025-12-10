import { getPocketbaseUrl } from '$lib/server/pocketbase'
import { getProject, updateProject } from '$lib/server/pb'

export interface Tool {
	name: string
	description: string
	parameters: {
		type: 'object'
		properties: Record<string, {
			type: string
			description: string
			enum?: string[]
		}>
		required: string[]
	}
}

export const TOOLS: Tool[] = [
	{
		name: 'write_code',
		description: 'Write code to App.svelte. Use this to create or update the application code.',
		parameters: {
			type: 'object',
			properties: {
				code: {
					type: 'string',
					description: 'The complete Svelte 5 component code to write to App.svelte'
				}
			},
			required: ['code']
		}
	},
	{
		name: 'create_content_field',
		description: 'Create a CMS-like content field that can be edited without code changes. Content fields are automatically available in the app via: import content from \'$content\'. Field names are slugified (e.g., "Hero Title" becomes content.hero_title). Example: import content from \'$content\'; let title = content.hero_title',
		parameters: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: 'Field name (e.g., "Hero Title", "App Name")'
				},
				type: {
					type: 'string',
					description: 'Field type',
					enum: ['text', 'textarea', 'number', 'boolean', 'json']
				},
				value: {
					type: 'string',
					description: 'Initial value for the field'
				},
				description: {
					type: 'string',
					description: 'Optional description of what this field is for'
				}
			},
			required: ['name', 'type', 'value']
		}
	},
	{
		name: 'create_design_field',
		description: `Create a design field (CSS variable) for styling the app. Design fields appear in the Design tab with specialized editors based on type.

Field types and their editors:
- color: Color palette picker (for colors like #3b82f6)
- size: Step slider 0-96px (for spacing, font sizes)
- font: Bunny Fonts picker with 1000+ fonts
- radius: Radius slider 0-full (for border-radius)
- shadow: Shadow presets (None, SM, MD, LG, XL, Inner)
- text: Plain text input (for custom values)

CSS VARIABLE NAMING: The CSS variable is auto-generated from the field name using kebab-case:
- "Page Background" → --page-background
- "Card Border Color" → --card-border-color
- "Button Hover Background" → --button-hover-background

When writing CSS, use the kebab-case version of the name you provide. Do NOT abbreviate.
Design fields are available in the app via var(--kebab-case-name) in CSS.`,
		parameters: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: 'Human-readable field name (e.g., "Page Background", "Card Border Color", "Body Font"). CSS variable is auto-generated as --kebab-case-name. Use full descriptive names, not abbreviations.'
				},
				type: {
					type: 'string',
					description: 'Field type determines the editor UI',
					enum: ['color', 'size', 'font', 'radius', 'shadow', 'text']
				},
				value: {
					type: 'string',
					description: 'Initial CSS value appropriate for the type (e.g., "#3b82f6" for color, "16px" for size, "Inter" for font)'
				},
				description: {
					type: 'string',
					description: 'Optional description of what this design field controls'
				}
			},
			required: ['name', 'type', 'value']
		}
	},
	{
		name: 'create_env_var',
		description: 'Create an environment variable for API keys, secrets, or config values',
		parameters: {
			type: 'object',
			properties: {
				key: {
					type: 'string',
					description: 'Environment variable name (e.g., "API_KEY", "STRIPE_SECRET")'
				},
				value: {
					type: 'string',
					description: 'The value to store'
				}
			},
			required: ['key', 'value']
		}
	},
	{
		name: 'create_endpoint',
		description: 'Configure a third-party API endpoint',
		parameters: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: 'Endpoint name (e.g., "Weather API", "Stripe Payment")'
				},
				url: {
					type: 'string',
					description: 'The API endpoint URL'
				},
				method: {
					type: 'string',
					description: 'HTTP method',
					enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
				},
				headers: {
					type: 'string',
					description: 'Optional headers as JSON string'
				}
			},
			required: ['name', 'url', 'method']
		}
	},
	{
		name: 'create_data_file',
		description: `Create a data collection for storing structured JSON data. Collections can be viewed and edited in the Data tab.

After creating a collection, access it in your code via:
  import data from '$data'

  // Subscribe to realtime updates (RECOMMENDED)
  $effect(() => {
    return data.todos.subscribe(items => { todos = items })
  })

  // CRUD operations (realtime updates UI automatically)
  await data.todos.create({ title: 'New todo', completed: false })
  await data.todos.update('abc123', { completed: true })
  await data.todos.delete('abc123')`,
		parameters: {
			type: 'object',
			properties: {
				filename: {
					type: 'string',
					description: 'Collection name (e.g., "todos", "users", "products")'
				},
				initial_data: {
					type: 'string',
					description: 'JSON array of initial records. Include 5-char alphanumeric `id` fields when records need to be referenced by other collections (relations). IDs auto-generate if omitted. Example: [{"id": "usr01", "name": "Alice"}, {"id": "usr02", "name": "Bob"}]'
				},
				description: {
					type: 'string',
					description: 'Optional description of what this collection stores'
				}
			},
			required: ['filename', 'initial_data']
		}
	},
	{
		name: 'insert_records',
		description: 'Insert multiple records into an existing data collection. Use this to add sample data or bulk insert records.',
		parameters: {
			type: 'object',
			properties: {
				collection: {
					type: 'string',
					description: 'Collection name (e.g., "todos", "users")'
				},
				records: {
					type: 'string',
					description: 'JSON array of records to insert. Include 5-char alphanumeric `id` fields when records need to be referenced by other collections. IDs auto-generate if omitted. Example: [{"id": "pst01", "title": "First", "author_id": "usr01"}]'
				}
			},
			required: ['collection', 'records']
		}
	},
	{
		name: 'read_config_field',
		description: 'Read the current value of a config field by name',
		parameters: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: 'Field name to read'
				}
			},
			required: ['name']
		}
	},
	{
		name: 'update_config_field',
		description: 'Update an existing config field value',
		parameters: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: 'Field name to update'
				},
				value: {
					type: 'string',
					description: 'New value for the field'
				}
			},
			required: ['name', 'value']
		}
	},
	{
		name: 'update_spec',
		description: 'Update the project specification document to reflect current architecture and components',
		parameters: {
			type: 'object',
			properties: {
				content: {
					type: 'string',
					description: 'Full markdown content of the updated specification'
				}
			},
			required: ['content']
		}
	}
]

interface DataConfig {
	env: Record<string, string>
	endpoints: Array<{
		id: string
		name: string
		url: string
		method: string
		headers?: Record<string, string>
	}>
	fields: Array<{
		id: string
		name: string
		type: string
		value: any
		description?: string
		customType?: string
		config?: Record<string, any>
	}>
	design?: Array<{
		id: string
		name: string
		css_var: string
		value: string
		description?: string
	}>
}

// Generate a short random ID (5 chars, alphanumeric)
function generate_id(): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
	let id = ''
	for (let i = 0; i < 5; i++) {
		id += chars[Math.floor(Math.random() * chars.length)]
	}
	return id
}

// Ensure all records have IDs (generate if missing)
function ensure_ids(records: any[]): any[] {
	const now = new Date().toISOString()
	return records.map(record => ({
		id: record.id || generate_id(),
		...record,
		created: record.created || now,
		updated: record.updated || now
	}))
}

async function readConfig(projectId: string): Promise<DataConfig> {
	try {
		const project = await getProject(projectId)
		return {
			env: {},
			endpoints: [],
			fields: project.content || [],
			design: project.design || []
		}
	} catch (error) {
		return { env: {}, endpoints: [], fields: [], design: [] }
	}
}

async function writeConfig(projectId: string, config: DataConfig): Promise<void> {
	await updateProject(projectId, {
		design: config.design,
		content: config.fields
	})
}

export async function executeTool(projectId: string, toolName: string, params: any): Promise<string> {
	try {
		switch (toolName) {
			case 'write_code': {
				// Validate code param exists and is not empty
				if (!params.code) {
					console.error('[Agent] write_code called with empty/missing code param!')
					return `Error: write_code called with empty code`
				}
				if (typeof params.code !== 'string') {
					console.error('[Agent] write_code called with non-string code:', typeof params.code)
					return `Error: write_code code must be a string`
				}
				const trimmedCode = params.code.trim()
				if (trimmedCode.length === 0) {
					console.error('[Agent] write_code called with whitespace-only code!')
					return `Error: write_code called with empty/whitespace code`
				}
				// Note: Snapshots are now created once per agent response, not per tool call
				await updateProject(projectId, { frontend_code: params.code })
				return `Wrote code to App.svelte (${params.code.length} chars)`
			}

			case 'create_content_field': {
				const config = await readConfig(projectId)

				// Check for duplicates
				const existingField = config.fields.find(f => f.name === params.name)
				if (existingField) {
					return `Content field "${params.name}" already exists with value: ${existingField.value}. Use update_content_field to modify it.`
				}

				// Note: Snapshots are now created once per agent response, not per tool call
				const newField = {
					id: Date.now().toString(),
					name: params.name,
					type: params.type,
					value: params.type === 'boolean' ? (params.value === 'true' || params.value === true) : params.value,
					description: params.description || ''
				}
				config.fields.push(newField)
				await writeConfig(projectId, config)
				return `Created content field "${params.name}" (${params.type}) with value: ${params.value}`
			}

			case 'create_design_field': {
				const config = await readConfig(projectId)
				if (!config.design) {
					config.design = []
				}

				// Auto-generate CSS variable from name (same logic as DesignPanel)
				const cssVar = '--' + params.name
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-|-$/g, '')

				// Check for duplicates by CSS variable name
				const existingField = config.design.find(f => f.css_var === cssVar)
				if (existingField) {
					return `Design field with CSS variable "${cssVar}" already exists (${existingField.name}). Use a different field name.`
				}

				// Validate type
				const validTypes = ['color', 'size', 'font', 'radius', 'shadow', 'text']
				const fieldType = params.type || 'text'
				if (!validTypes.includes(fieldType)) {
					return `Invalid field type "${params.type}". Must be one of: ${validTypes.join(', ')}`
				}

				// Note: Snapshots are now created once per agent response, not per tool call
				const newField: any = {
					id: Date.now().toString(),
					name: params.name,
					css_var: cssVar,
					value: params.value,
					type: fieldType,
					description: params.description || ''
				}

				// Add type-specific config
				if (fieldType === 'size' || fieldType === 'radius') {
					newField.unit = 'px'
					if (fieldType === 'radius') {
						newField.min = 0
						newField.max = 50
					}
				}

				config.design.push(newField)
				await writeConfig(projectId, config)
				return `Created ${fieldType} design field "${params.name}" (${newField.css_var}) with value: ${params.value}`
			}

			case 'create_env_var': {
				const config = await readConfig(projectId)

				// Check if env var already exists
				if (config.env[params.key]) {
					return `Environment variable "${params.key}" already exists. Updating value.`
				}

				config.env[params.key] = params.value
				await writeConfig(projectId, config)
				return `Created environment variable ${params.key}`
			}

			case 'create_endpoint': {
				const config = await readConfig(projectId)
				const newEndpoint = {
					id: Date.now().toString(),
					name: params.name,
					url: params.url,
					method: params.method,
					headers: params.headers ? JSON.parse(params.headers) : {}
				}
				config.endpoints.push(newEndpoint)
				await writeConfig(projectId, config)
				return `Created endpoint "${params.name}" (${params.method} ${params.url})`
			}

			case 'create_data_file': {
				const project = await getProject(projectId)
				const currentData = project.data || {}

				// Check if file already exists
				if (currentData[params.filename]) {
					return `Collection "${params.filename}" already exists. Use insert_records to add more data or choose a different name.`
				}

				// Parse initial data
				const initialRecords = typeof params.initial_data === 'string'
					? JSON.parse(params.initial_data)
					: params.initial_data

				// Validate it's an array
				if (!Array.isArray(initialRecords)) {
					throw new Error('initial_data must be a JSON array')
				}

				// Ensure all records have IDs
				const recordsWithIds = ensure_ids(initialRecords)

				// Infer schema from first record (if any), excluding meta fields
				const schema: Array<{ name: string; type: string }> = []
				if (recordsWithIds.length > 0) {
					const firstRecord = recordsWithIds[0]
					for (const [key, value] of Object.entries(firstRecord)) {
						if (['id', 'created', 'updated'].includes(key)) continue
						let type = 'text'
						if (typeof value === 'number') type = 'number'
						else if (typeof value === 'boolean') type = 'boolean'
						schema.push({ name: key, type })
					}
				}

				// Note: Snapshots are now created once per agent response, not per tool call
				// Add to project.data with new format
				currentData[params.filename] = { schema, records: recordsWithIds }
				await updateProject(projectId, { data: currentData })

				return `Created collection "${params.filename}" with ${initialRecords.length} records. Access via: import data from '$data'; data.${params.filename}.list()`
			}

			case 'insert_records': {
				const project = await getProject(projectId)
				const currentData = project.data || {}

				// Check if collection exists
				if (!currentData[params.collection]) {
					return `Collection "${params.collection}" does not exist. Create it first with create_data_file.`
				}

				// Parse records
				const newRecords = typeof params.records === 'string'
					? JSON.parse(params.records)
					: params.records

				// Validate it's an array
				if (!Array.isArray(newRecords)) {
					throw new Error('records must be a JSON array')
				}

				// Note: Snapshots are now created once per agent response, not per tool call
				// Get existing collection data - handle both { schema, records } and legacy array format
				const collectionData = currentData[params.collection]
				let existingRecords: any[]
				let schema: Array<{ name: string; type: string }>

				if (Array.isArray(collectionData)) {
					// Legacy format: just an array
					existingRecords = collectionData
					schema = []
				} else {
					existingRecords = collectionData.records || []
					schema = collectionData.schema || []
				}

				// Ensure all new records have IDs
				const newRecordsWithIds = ensure_ids(newRecords)

				// Infer schema from records if empty, excluding meta fields
				if (schema.length === 0) {
					const allRecordsForInference = [...existingRecords, ...newRecordsWithIds]
					if (allRecordsForInference.length > 0) {
						const firstRecord = allRecordsForInference[0]
						for (const [key, value] of Object.entries(firstRecord)) {
							if (['id', 'created', 'updated'].includes(key)) continue
							let type = 'text'
							if (typeof value === 'number') type = 'number'
							else if (typeof value === 'boolean') type = 'boolean'
							schema.push({ name: key, type })
						}
					}
				}

				// Append records
				const allRecords = [...existingRecords, ...newRecordsWithIds]
				currentData[params.collection] = { schema, records: allRecords }
				await updateProject(projectId, { data: currentData })

				return `Inserted ${newRecords.length} records into "${params.collection}". Total: ${allRecords.length} records.`
			}

			case 'read_config_field': {
				const config = await readConfig(projectId)
				const field = config.fields.find(f => f.name === params.name)
				if (!field) {
					return `Field "${params.name}" not found`
				}
				return `Field "${field.name}" (${field.type}): ${JSON.stringify(field.value)}`
			}

			case 'update_config_field': {
				const config = await readConfig(projectId)
				const field = config.fields.find(f => f.name === params.name)
				if (!field) {
					return `Field "${params.name}" not found`
				}
				// Note: Snapshots are now created once per agent response, not per tool call
				field.value = params.type === 'boolean' ? (params.value === 'true' || params.value === true) : params.value
				await writeConfig(projectId, config)
				return `Updated field "${params.name}" to: ${params.value}`
			}

			case 'update_spec': {
				// Note: Snapshots are now created once per agent response, not per tool call
				await updateProject(projectId, { custom_instructions: params.content })
				return `Updated project specification`
			}

			default:
				throw new Error(`Unknown tool: ${toolName}`)
		}
	} catch (error: any) {
		return `Error executing ${toolName}: ${error.message}`
	}
}

export function getToolsPrompt(): string {
	const toolSummaries = TOOLS.map(tool => {
		const params = Object.entries(tool.parameters.properties).map(([key, prop]) => {
			const opt = tool.parameters.required.includes(key) ? '' : '?'
			const enums = prop.enum ? `[${prop.enum.join('|')}]` : ''
			return `${key}${opt}${enums}`
		}).join(', ')
		// First sentence of description only
		const desc = tool.description.split('\n')[0]
		return `- **${tool.name}**(${params}): ${desc}`
	}).join('\n')

	return `
## Tools
${toolSummaries}

Usage: \`<tool><name>NAME</name><parameters>{"key": "value"}</parameters></tool>\``
}
