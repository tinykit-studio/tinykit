// Match the sorted JSON serialization used by PocketBase's definitions.cjs.
export function canonicalData(value: any): string {
	if (Array.isArray(value)) return '[' + value.map(canonicalData).join(',') + ']'
	if (value && typeof value === 'object') {
		return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalData(value[key])).join(',') + '}'
	}
	return JSON.stringify(value)
}
