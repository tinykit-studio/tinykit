export class DataMutationError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export function assert_unique_record(records: any[], body: Record<string, any>, fields: string[]) {
  if (body.id != null && records.some(record => String(record.id) === String(body.id))) {
    throw new DataMutationError(409, 'A record with this ID already exists.')
  }
  if (!fields.length) return
  if (fields.length > 8 || fields.some(field => !/^[a-zA-Z_]\w{0,63}$/.test(field))) {
    throw new DataMutationError(400, 'Invalid unique fields.')
  }
  const normalize = (value: any) => typeof value === 'string' ? value.trim().toLowerCase() : value
  if (fields.some(field => body[field] == null || !['string', 'number', 'boolean'].includes(typeof body[field]) || normalize(body[field]) === '')) {
    throw new DataMutationError(400, 'Unique fields need a non-empty value.')
  }
  if (records.some(record => fields.every(field => normalize(record[field]) === normalize(body[field])))) {
    throw new DataMutationError(409, `A record with this ${fields.join(', ')} already exists.`)
  }
}

// Calculate the entire batch before saving so a vote move cannot be half-applied.
export function adjust_counters(collection: any, changes: unknown) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 20) {
    throw new DataMutationError(400, 'Provide between 1 and 20 counter changes.')
  }
  const records = (Array.isArray(collection) ? collection : collection?.records || []).map((record: any) => ({...record}))
  const schema = collection?.schema || []
  const updated = new Set<string>()
  for (const change of changes) {
    if (!change || typeof change.id !== 'string' || !change.id || typeof change.field !== 'string' ||
        !schema.some((field: any) => field.name === change.field && field.type === 'number') || change.field === 'id' ||
        !Number.isSafeInteger(change.delta) || Math.abs(change.delta) > 1000000) {
      throw new DataMutationError(400, 'Counter changes require a record ID, numeric schema field, and integer delta.')
    }
    const record = records.find((record: any) => String(record.id) === change.id)
    if (!record) throw new DataMutationError(404, 'Record not found.')
    const current = Number(record[change.field] ?? 0)
    if (!Number.isSafeInteger(current) || !Number.isSafeInteger(current + change.delta)) {
      throw new DataMutationError(400, 'Counter value must be a safe integer.')
    }
    record[change.field] = Math.max(0, current + change.delta)
    updated.add(String(record.id))
  }
  return {records, items: records.filter((record: any) => updated.has(String(record.id)))}
}
