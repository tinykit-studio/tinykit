/**
 * Create an isolated $data module for the template gallery. Mutations stay in
 * the iframe and are discarded when the preview closes.
 * @param {string[]} names
 */
export function generate_memory_data_module(names) {
  return `
const clone = value => JSON.parse(JSON.stringify(value));
const collections = {};
function createCollection(name) {
  let rows = [];
  let schema = [];
  const subscribers = new Set();
  const notify = () => queueMicrotask(() => subscribers.forEach(callback => callback(clone(rows))));
  return {
    _replace(value) { rows = clone(Array.isArray(value) ? value : value?.records || []); schema = clone(value?.schema || []); notify(); },
    async list() { return clone(rows); },
    async get(id) { return clone(rows.find(row => row.id === id) || null); },
    async create(fields, options = {}) {
      const unique = options.unique || [];
      const normalize = value => typeof value === 'string' ? value.trim().toLowerCase() : value;
      if (!Array.isArray(unique)) throw new TypeError('unique must be an array of fields');
      if (rows.some(row => fields.id && row.id === fields.id || unique.length && unique.every(field => normalize(row[field]) === normalize(fields[field])))) {
        const error = new Error('A record with this value already exists.'); error.status = 409; throw error;
      }
      const row = {...clone(fields), id: fields.id || crypto.randomUUID()};
      rows = [...rows, row]; notify(); return clone(row);
    },
    async adjust(changes) {
      if (!Array.isArray(changes) || !changes.length || changes.length > 20) throw new Error('Provide between 1 and 20 counter changes.');
      const next = clone(rows), updated = new Set();
      for (const change of changes) {
        if (!change || typeof change.id !== 'string' || !schema.some(field => field.name === change.field && field.type === 'number') || change.field === 'id' || !Number.isSafeInteger(change.delta) || Math.abs(change.delta) > 1000000) throw new Error('Invalid counter change.');
        const row = next.find(row => String(row.id) === change.id);
        if (!row) throw new Error('Record not found');
        const value = Number(row[change.field] ?? 0);
        if (!Number.isSafeInteger(value) || !Number.isSafeInteger(value + change.delta)) throw new Error('Invalid counter value.');
        row[change.field] = Math.max(0, value + change.delta); updated.add(String(row.id));
      }
      rows = next; notify(); return clone(rows.filter(row => updated.has(String(row.id))));
    },
    async update(id, fields) {
      const index = rows.findIndex(row => row.id === id);
      if (index === -1) throw new Error('Record not found');
      const row = {...rows[index], ...clone(fields), id};
      rows = rows.map((value, i) => i === index ? row : value); notify(); return clone(row);
    },
    async delete(id) { rows = rows.filter(row => row.id !== id); notify(); return true; },
    subscribe(callback) {
      subscribers.add(callback);
      queueMicrotask(() => { if (subscribers.has(callback)) callback(clone(rows)); });
      return () => subscribers.delete(callback);
    }
  };
}
for (const name of ${JSON.stringify(names)}) collections[name] = createCollection(name);
window.__tk_update_data = data => {
  for (const [name, collection] of Object.entries(collections)) {
    if (Object.hasOwn(data, name)) collection._replace(data[name]);
  }
};
export default collections;
`.trim();
}
