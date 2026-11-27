import type { ContentField, DesignField } from '../routes/tinykit/types'

const object = (value: any): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Read both Studio app exports and the older History snapshot format. */
export function normalizeProjectImport(value: unknown, filename = 'import.json') {
	if (!object(value) || !['frontend_code', 'content', 'design'].some(key => Object.hasOwn(value, key))) {
		throw new Error('Choose a Tinykit app export or snapshot JSON file.')
	}
	for (const key of ['frontend_code', 'backend_code', 'custom_instructions']) {
		if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error(`Invalid ${key} in import file.`)
	}
	for (const key of ['content', 'design']) {
		if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some((field: any) => !object(field) || typeof field.name !== 'string' || typeof field.type !== 'string'))) {
			throw new Error(`Invalid ${key} fields in import file.`)
		}
	}
	const fields = (key: 'content' | 'design') => {
		const existing = new Set<string>()
		for (const field of value[key] || []) if (typeof field.id === 'string' && field.id) {
			if (existing.has(field.id)) throw new Error(`Duplicate ${key} field ID in import file.`)
			existing.add(field.id)
		}
		return (value[key] || []).map((field: any, index: number) => {
			if (typeof field.id === 'string' && field.id) return field
			let id = `imported-${key}-${index}`
			while (existing.has(id)) id += '_'
			existing.add(id)
			return { ...field, id }
		})
	}
	const data: Record<string, any> = {}
	const addCollection = (name: string, collection: any) => {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Invalid collection name in import file.')
		if (Array.isArray(collection)) collection = { schema: [], records: collection }
		if (!object(collection) || !Array.isArray(collection.schema ?? []) || !Array.isArray(collection.records ?? [])) throw new Error(`Invalid collection "${name}" in import file.`)
		if ((collection.schema || []).some((field: any) => !object(field) || typeof field.name !== 'string' || typeof field.type !== 'string') || (collection.records || []).some((row: any) => !object(row))) throw new Error(`Invalid schema or records in "${name}".`)
		data[name] = { ...collection, schema: collection.schema ?? [], records: collection.records ?? [] }
	}
	if (value.data !== undefined) {
		if (!object(value.data)) throw new Error('Invalid app data in import file.')
		for (const [name, collection] of Object.entries(value.data)) addCollection(name, collection)
	} else if (value.collections !== undefined) {
		if (!Array.isArray(value.collections)) throw new Error('Invalid snapshot collections.')
		for (const collection of value.collections) {
			if (!object(collection) || typeof collection.name !== 'string' || Object.hasOwn(data, collection.name)) throw new Error('Invalid or duplicate snapshot collection.')
			const { name, ...definition } = collection
			addCollection(name, definition)
		}
	}
	const name = [value.name, value.description, filename.replace(/\.json$/i, '').replace(/^snapshot-\d{4}-\d{2}-\d{2}-/, '')].find(item => typeof item === 'string' && item.trim()) || 'Imported app'
	return {
		name: name.trim(),
		frontend_code: value.frontend_code ?? '',
		backend_code: value.backend_code ?? '',
		custom_instructions: value.custom_instructions ?? '',
		design: fields('design') as DesignField[],
		content: fields('content') as ContentField[],
		data
	}
}
