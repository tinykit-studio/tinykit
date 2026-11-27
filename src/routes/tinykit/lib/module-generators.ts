// Module generators for production HTML builds
// These generate the JavaScript modules that get embedded in the built HTML

/**
 * Generate the $data module code
 * This creates a db object with collection accessors that proxy to the /_tk/data API
 * Includes realtime subscription support via PocketBase
 */
export function generate_data_module(project_id: string, collections: string[]): string {
	// Guard against undefined/null project_id being stringified
	const safe_project_id = project_id || ''

	// Generate collection entries
	const collection_entries = collections
		.map(name => `  ${name}: create_collection('${name}')`)
		.join(',\n')

	return `
const PROJECT_ID = '${safe_project_id}'
const API_BASE = '/_tk/data'

// Validate PROJECT_ID is set
if (!PROJECT_ID) {
  console.warn('[db] No project ID configured - data operations will fail')
}

// Global registry for realtime updates
const _collections = {}

function create_collection(name) {
  const base_url = \`\${API_BASE}/\${PROJECT_ID}/\${name}\`
  let subscribers = []
  let cache = null
  const update_queue = new Map()
  let last_params = null
  let mutation_cooldown = 0 // Timestamp until which we ignore external updates
  let cache_revision = 0
  let notifying = false // Reentrancy guard to prevent infinite loops

  // Compare two record arrays for equality (by JSON serialization)
  function records_equal(a, b) {
    if (!a || !b) return false
    if (a.length !== b.length) return false
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch (e) {
      return false
    }
  }

  // Check if value is a File object
  function isFile(v) {
    return typeof File !== 'undefined' && v instanceof File
  }

  // Check if data contains any File objects
  function hasFiles(data) {
    for (const v of Object.values(data)) {
      if (isFile(v)) return true
      if (Array.isArray(v) && v.length > 0 && isFile(v[0])) return true
    }
    return false
  }

  // Prepare request body - handles FormData passthrough, File auto-detection, and JSON
  function prepareRequestBody(data) {
    // FormData passthrough (Pocketbase-style)
    if (typeof FormData !== 'undefined' && data instanceof FormData) {
      return { body: data, headers: {} }
    }

    // Auto-detect File objects and build FormData
    if (hasFiles(data)) {
      const form = new FormData()
      const jsonFields = {}

      for (const [key, value] of Object.entries(data)) {
        if (isFile(value)) {
          form.append('_file:' + key, value)
        } else if (Array.isArray(value) && value.length > 0 && isFile(value[0])) {
          value.forEach(f => form.append('_file:' + key, f))
        } else {
          jsonFields[key] = value
        }
      }

      form.append('_data', JSON.stringify(jsonFields))
      return { body: form, headers: {} }
    }

    // Plain JSON
    return {
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' }
    }
  }

  const collection = {
    // Notify all subscribers with new data (skip if unchanged or in cooldown)
    _notify(records, force = false) {
      // Prevent reentrant calls - if a subscriber triggers another mutation,
      // don't recursively notify (the mutation will schedule its own notification)
      if (notifying) return

      // During cooldown period, ignore external updates (SSE/realtime)
      // This prevents re-renders when our own mutations echo back
      if (!force && Date.now() < mutation_cooldown) {
        return
      }
      if (!force && records_equal(cache, records)) {
        return // Skip notification if data hasn't changed
      }
      cache = records
      cache_revision++
      notifying = true
      try {
        for (const cb of subscribers) {
          try { cb(records) } catch (e) { console.error('[db] subscriber error:', e) }
        }
      } finally {
        notifying = false
      }
    },

    // Set a cooldown period during which external updates are ignored
    _set_cooldown(ms = 500) {
      mutation_cooldown = Date.now() + ms
    },

    // Refresh cache from server and notify
    async _refresh() {
      try {
        await collection.list(last_params || {})
      } catch (e) {
        console.error('[db] refresh error:', e)
      }
    },

    async list(params = {}) {
      last_params = params
      const revision = cache_revision
      const query = new URLSearchParams()
      if (params.filter) query.set('filter', params.filter)
      if (params.sort) query.set('sort', params.sort)
      if (params.page) query.set('page', String(params.page))
      if (params.perPage) query.set('perPage', String(params.perPage))
      if (params.expand) query.set('expand', params.expand)
      if (params.all) { query.set('page', '1'); query.set('perPage', '100') }

      const items = []
      const seen = new Set()
      let page = 1, total_pages = 1
      do {
        if (params.all) query.set('page', String(page))
        const res = await fetch(base_url + '?' + query.toString())
        if (!res.ok) throw new Error(await res.text())
        const result = await res.json()
        for (const item of result.items || []) {
          const id = item?.id == null ? null : String(item.id)
          if (params.all && id !== null && seen.has(id)) continue
          if (id !== null) seen.add(id)
          items.push(item)
        }
        if (params.all) {
          total_pages = Math.max(1, Number(result.totalPages || 1))
          if (!Number.isSafeInteger(total_pages)) throw new Error('Invalid pagination response.')
        }
        page++
      } while (params.all && page <= total_pages)

      // A complete live snapshot or a confirmed local edit is newer than a
      // paginated request that started before it. Never replace it with a
      // partial or older result, including a retry completing out of order.
      if (params.all && cache_revision !== revision && cache) return cache
      cache = items
      cache_revision++
      return items
    },

    async get(id, params = {}) {
      const query = new URLSearchParams()
      if (params.expand) query.set('expand', params.expand)

      const res = await fetch(\`\${base_url}/\${id}?\${query}\`)
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },

    async create(data, options = {}) {
      const query = new URLSearchParams()
      if (options.unique && !Array.isArray(options.unique)) throw new TypeError('unique must be an array of fields')
      for (const field of options.unique || []) query.append('unique', field)
      const suffix = query.toString()
      const create_url = base_url + (suffix ? '?' + suffix : '')
      // Support FormData passthrough, File objects auto-detection, or plain JSON
      const { body, headers } = prepareRequestBody(data)
      const res = await fetch(create_url, { method: 'POST', headers, body })
      if (!res.ok) {
        let message = await res.text()
        try { message = JSON.parse(message).message || message } catch {}
        const error = new Error(message)
        error.status = res.status
        throw error
      }
      const record = await res.json()
      // Set cooldown to ignore echo from our own mutation
      collection._set_cooldown(500)
      // Optimistically update local cache
      if (cache) {
      // Realtime may deliver the created record before the POST response.
      cache = [...cache.filter(item => item.id !== record.id), record]
        collection._notify(cache, true)
      }
      return record
    },

    async adjust(changes) {
      const revision = cache_revision
      const res = await fetch(base_url + '/_adjust', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(changes)
      })
      if (!res.ok) {
        let message = await res.text()
        try { message = JSON.parse(message).message || message } catch {}
        const error = new Error(message)
        error.status = res.status
        throw error
      }
      const records = await res.json()
      if (cache) {
        if (cache_revision !== revision) {
          // Realtime may already include later votes. Refresh instead of
          // replacing them with this earlier write response. A refresh error
          // must not make a successfully committed vote look like a failure.
          try { collection._notify(await collection.list(last_params || {}), true) } catch {}
        } else {
          const updated = new Map(records.map(record => [String(record.id), record]))
          collection._notify(cache.map(record => updated.get(String(record.id)) || record), true)
        }
      }
      return records
    },

    async update(id, data) {
      // Serialize writes to a record so an older response cannot overwrite a later edit.
      const previous_request = update_queue.get(id)
      let release
      const pending = new Promise(resolve => { release = resolve })
      update_queue.set(id, pending)
      if (previous_request) await previous_request
      try {
        collection._set_cooldown(500)
        const previous = cache?.find(r => r.id === id)
        const optimistic = previous ? { ...previous, ...data } : null
        if (optimistic) {
          cache = cache.map(r => r.id === id ? optimistic : r)
          collection._notify(cache, true)
        }
        try {
          const { body, headers } = prepareRequestBody(data)
          const res = await fetch(\`\${base_url}/\${id}\`, { method: 'PATCH', headers, body })
          if (!res.ok) throw new Error(await res.text())
          const record = await res.json()
          // Replace temporary File objects with the filenames returned by storage.
          if (cache) {
            cache = cache.map(r => r.id === id ? record : r)
            collection._notify(cache, true)
          }
          return record
        } catch (err) {
          // Only roll back this mutation, preserving unrelated record changes.
          if (cache && previous) {
            cache = cache.map(r => r === optimistic ? previous : r)
            collection._notify(cache, true)
          }
          throw err
        }
      } finally {
        release()
        if (update_queue.get(id) === pending) update_queue.delete(id)
      }
    },

    async delete(id) {
      // Keep deletion ordered with pending edits to the same record.
      const previous_request = update_queue.get(id)
      let release
      const pending = new Promise(resolve => { release = resolve })
      update_queue.set(id, pending)
      if (previous_request) await previous_request
      const previous_index = cache?.findIndex(record => record.id === id) ?? -1
      const previous = previous_index < 0 ? null : cache[previous_index]
      try {
        collection._set_cooldown(500)
        if (cache) collection._notify(cache.filter(record => record.id !== id), true)
        const res = await fetch(\`\${base_url}/\${id}\`, { method: 'DELETE' })
        if (!res.ok) throw new Error(await res.text())
        // A list request may have finished while deletion was pending.
        if (cache) collection._notify(cache.filter(record => record.id !== id), true)
        return true
      } catch (error) {
        // Restore only this row, preserving edits and new records elsewhere.
        if (cache && previous && !cache.some(record => record.id === id)) {
          const restored = [...cache]
          restored.splice(Math.min(previous_index, restored.length), 0, previous)
          collection._notify(restored, true)
        }
        throw error
      } finally {
        release()
        if (update_queue.get(id) === pending) update_queue.delete(id)
      }
    },

    /**
     * Subscribe to realtime updates for this collection
     * @param {function} callback - Called with array of records on each update
     * @param {object} params - Optional list params (filter, sort, etc.)
     * @param {function} onError - Optional initial-load failure callback
     * @returns {function} Unsubscribe function
     */
    subscribe(callback, params = {}, onError) {
      let active = true
      subscribers.push(callback)
      last_params = params

      // Initial fetch - explicitly notify this subscriber
      collection.list(params)
        .then(items => { if (active) callback(items) })
        .catch(error => {
            if (!active) return
            if (typeof onError === 'function') onError(error)
            else console.error('[db] initial fetch error:', error)
          })

      // Return unsubscribe function
      return () => {
        active = false
        const idx = subscribers.indexOf(callback)
        if (idx > -1) subscribers.splice(idx, 1)
      }
    }
  }

  // Register in global registry
  _collections[name] = collection
  return collection
}

// Handle realtime updates (called by PB subscription)
if (typeof window !== 'undefined') {
  window.__tk_update_data = (all_data) => {
    for (const [name, collection] of Object.entries(_collections)) {
      if (all_data[name]) {
        const records = all_data[name].records || all_data[name] || []
        collection._notify(Array.isArray(records) ? records : [])
      }
    }
  }

  // Production mode: connect to SSE endpoint for realtime
  const sse = new EventSource('/_tk/realtime/' + PROJECT_ID)

  sse.addEventListener('data_updated', (e) => {
    // Skip if no data or data is the literal string "undefined"
    if (!e.data || e.data === 'undefined') return
    try {
      const data = JSON.parse(e.data)
      window.__tk_update_data(data)
    } catch (err) {
      console.warn('[db] Failed to parse realtime data:', err)
    }
  })

  sse.addEventListener('error', () => {
    console.warn('[db] SSE connection error, will retry...')
  })
}

// Create stub collection for unknown/not-yet-loaded collections
function create_stub_collection(name) {
  console.warn('[db] Collection "' + name + '" not found - returning stub')
  return {
    _notify() {},
    _set_cooldown() {},
    _refresh() { return Promise.resolve() },
    list() { return Promise.resolve([]) },
    get() { return Promise.resolve(null) },
    create(data) {
      // Try to create - collection may exist on server even if not predefined
      const base_url = \`\${API_BASE}/\${PROJECT_ID}/\${name}\`
      return fetch(base_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to create')))
    },
    update() { return Promise.reject(new Error('Collection "' + name + '" not available')) },
    delete() { return Promise.reject(new Error('Collection "' + name + '" not available')) },
    subscribe(cb) {
      // Try to fetch from API - collection may exist on server
      const base_url = \`\${API_BASE}/\${PROJECT_ID}/\${name}\`
      fetch(base_url)
        .then(r => r.ok ? r.json() : { items: [] })
        .then(data => cb(data.items || []))
        .catch(() => cb([]))
      return () => {} // noop unsubscribe
    }
  }
}

const _defined_collections = {
${collection_entries}
}

// Proxy to return stub for unknown collections
const db = new Proxy(_defined_collections, {
  get(target, prop) {
    if (prop in target) return target[prop]
    if (typeof prop === 'string' && !prop.startsWith('_')) {
      return create_stub_collection(prop)
    }
    return undefined
  }
})

export default db
`.trim()
}

/**
 * Generate the $tk module code (tinykit utilities)
 */
export function generate_tinykit_module(project_id: string): string {
	return `
const PROJECT_ID = '${project_id}'

export function asset(filename, options) {
  if (!filename) return ''
  if (filename.startsWith('http://') || filename.startsWith('https://')) {
    return filename
  }
  let url = '/_tk/assets/' + PROJECT_ID + '/' + filename
  const params = []
  if (options?.thumb) params.push('thumb=' + options.thumb)
  if (options?.download) params.push('download=1')
  if (params.length) url += '?' + params.join('&')
  return url
}

export async function proxy(url, options = {}) {
  const proxy_url = '/api/proxy?url=' + encodeURIComponent(url)
  return fetch(proxy_url, options)
}
proxy.json = async function(url) {
  const response = await proxy(url)
  if (!response.ok) throw new Error('Failed to fetch: ' + response.status)
  return response.json()
}
proxy.text = async function(url) {
  const response = await proxy(url)
  if (!response.ok) throw new Error('Failed to fetch: ' + response.status)
  return response.text()
}
proxy.url = function(url) {
  return '/api/proxy?url=' + encodeURIComponent(url)
}
`.trim()
}
