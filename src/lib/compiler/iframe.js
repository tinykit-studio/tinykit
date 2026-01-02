import { generate_font_links } from './fonts.js'
import { transform_content_fields } from './content-utils'

/**
 * Generate CSS variables from design fields
 * @param {any[]} design
 * @returns {string}
 */
export const generate_design_css = (design) => {
  if (!design || design.length === 0) {
    return ':root {}'
  }
  const vars = design.map(field => `  ${field.css_var}: ${field.value};`).join('\n')
  return `:root {\n${vars}\n}`
}

/**
 * Generate the $data module code for the preview iframe
 * @param {string} project_id
 * @param {string[]} collections
 * @returns {string}
 */
const generate_data_module = (project_id, collections) => {
  const collection_entries = collections
    .map(name => `  ${name}: create_collection('${name}')`)
    .join(',\n')

  return `
const PROJECT_ID = '${project_id}'
const API_BASE = '/_tk/data'

// Global registry for realtime updates
const _collections = {}

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
  // FormData passthrough
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

function create_collection(name) {
  const base_url = \`\${API_BASE}/\${PROJECT_ID}/\${name}\`
  let subscribers = []
  let cache = null
  let last_params = null
  let mutation_cooldown = 0 // Timestamp until which we ignore external updates

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

  const collection = {
    // Notify all subscribers with new data (skip if unchanged or in cooldown)
    _notify(records, force = false) {
      // During cooldown period, ignore external updates (SSE/realtime)
      // This prevents re-renders when our own mutations echo back
      if (!force && Date.now() < mutation_cooldown) {
        return
      }
      if (!force && records_equal(cache, records)) {
        return // Skip notification if data hasn't changed
      }
      cache = records
      for (const cb of subscribers) {
        try { cb(records) } catch (e) { console.error('[db] subscriber error:', e) }
      }
    },

    // Set a cooldown period during which external updates are ignored
    _set_cooldown(ms = 500) {
      mutation_cooldown = Date.now() + ms
    },

    // Refresh cache from server and notify
    async _refresh() {
      try {
        const items = await collection.list(last_params || {})
        // list() already updates cache and notifies
      } catch (e) {
        console.error('[db] refresh error:', e)
      }
    },

    async list(params = {}) {
      last_params = params
      const query = new URLSearchParams()
      if (params.filter) query.set('filter', params.filter)
      if (params.sort) query.set('sort', params.sort)
      if (params.page) query.set('page', String(params.page))
      if (params.perPage) query.set('perPage', String(params.perPage))
      if (params.expand) query.set('expand', params.expand)

      const res = await fetch(\`\${base_url}?\${query}\`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      const items = data.items || []
      // Update cache silently - don't notify subscribers
      // Notifications come from: subscribe() initial load, mutations, external events
      cache = items
      return items
    },

    async get(id, params = {}) {
      const query = new URLSearchParams()
      if (params.expand) query.set('expand', params.expand)

      const res = await fetch(\`\${base_url}/\${id}?\${query}\`)
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },

    async create(data) {
      // Generate client-side ID if not provided (prevents race conditions with SSE)
      const record_data = data.id ? data : { ...data, id: crypto.randomUUID().slice(0, 5) }
      // Support FormData passthrough, File objects auto-detection, or plain JSON
      const { body, headers } = prepareRequestBody(record_data)
      const res = await fetch(base_url, { method: 'POST', headers, body })
      if (!res.ok) throw new Error(await res.text())
      const record = await res.json()
      // Set cooldown to ignore echo from our own mutation
      collection._set_cooldown(500)
      // Optimistically update local cache (check for duplicates - SSE may have arrived first)
      if (cache) {
        const exists = cache.some(r => r.id === record.id)
        if (!exists) {
          cache = [...cache, record]
        }
        collection._notify(cache, true)
      }
      return record
    },

    async update(id, data) {
      // Set cooldown to ignore echo from our own mutation
      collection._set_cooldown(500)
      // Optimistically update local cache first (before server roundtrip)
      if (cache) {
        const idx = cache.findIndex(r => r.id === id)
        if (idx !== -1) {
          cache = cache.map(r => r.id === id ? { ...r, ...data } : r)
          collection._notify(cache, true)
        }
      }
      // Support FormData passthrough, File objects auto-detection, or plain JSON
      const { body, headers } = prepareRequestBody(data)
      const res = await fetch(\`\${base_url}/\${id}\`, { method: 'PATCH', headers, body })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },

    async delete(id) {
      // Set cooldown to ignore echo from our own mutation
      collection._set_cooldown(500)
      // Optimistically update local cache first
      if (cache) {
        cache = cache.filter(r => r.id !== id)
        collection._notify(cache, true)
      }
      const res = await fetch(\`\${base_url}/\${id}\`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      return true
    },

    /**
     * Subscribe to realtime updates for this collection
     * @param {function} callback - Called with array of records on each update
     * @param {object} params - Optional list params (filter, sort, etc.)
     * @returns {function} Unsubscribe function
     */
    subscribe(callback, params = {}) {
      // Validate callback is a function
      if (typeof callback !== 'function') {
        console.error('[db] subscribe() requires a function callback, got:', typeof callback)
        return () => {} // Return noop unsubscribe
      }

      subscribers.push(callback)
      last_params = params

      // Initial fetch - explicitly notify this subscriber
      collection.list(params)
        .then(items => callback(items))
        .catch(e => console.error('[db] initial fetch error:', e))

      // Return unsubscribe function
      return () => {
        const idx = subscribers.indexOf(callback)
        if (idx > -1) subscribers.splice(idx, 1)
      }
    }
  }

  // Register in global registry
  _collections[name] = collection
  return collection
}

// Handle realtime updates from parent frame (preview mode)
if (typeof window !== 'undefined') {
  window.__tk_update_data = (all_data) => {
    for (const [name, collection] of Object.entries(_collections)) {
      if (all_data[name]) {
        const records = all_data[name].records || all_data[name] || []
        collection._notify(Array.isArray(records) ? records : [])
      }
    }
  }

  // Detect if we're in standalone mode (not in iframe)
  const is_standalone = window.parent === window

  if (is_standalone) {
    // Production mode: connect to SSE endpoint for realtime
    const sse = new EventSource('/_tk/realtime/' + PROJECT_ID)

    sse.addEventListener('data_updated', (e) => {
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
    create() { return Promise.reject(new Error('Collection "' + name + '" not available')) },
    update() { return Promise.reject(new Error('Collection "' + name + '" not available')) },
    delete() { return Promise.reject(new Error('Collection "' + name + '" not available')) },
    subscribe(cb) {
      // Call with empty array immediately so loading states resolve
      setTimeout(() => cb([]), 0)
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
 * Generate the $tinykit module code (tinykit utilities)
 * @param {string} project_id
 * @returns {string}
 */
const generate_tinykit_module = (project_id) => {
  return `
const PROJECT_ID = '${project_id}'

/**
 * Get the URL for an uploaded asset file
 * @param {string} filename - The filename stored in the record
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.thumb] - Thumbnail size, e.g. "100x100", "300x0", "100x100f"
 * @param {boolean} [options.download] - Force download instead of preview
 * @returns {string} The full URL to the asset
 */
export function asset(filename, options) {
  if (!filename) return ''
  // If it's already a full URL (e.g., from external source), return as-is
  if (filename.startsWith('http://') || filename.startsWith('https://')) {
    return filename
  }
  // Use path-based project_id so query params stay clean for thumb/download
  let url = PROJECT_ID ? '/_tk/assets/' + PROJECT_ID + '/' + filename : '/_tk/assets/' + filename
  const params = []
  if (options?.thumb) params.push('thumb=' + options.thumb)
  if (options?.download) params.push('download=1')
  if (params.length) url += '?' + params.join('&')
  return url
}

/**
 * Fetch external resources through the tinykit proxy (bypasses CORS)
 * @param {string} url - The URL to fetch
 * @param {RequestInit} [options] - Fetch options (method, headers, etc.)
 * @returns {Promise<Response>}
 */
export async function proxy(url, options = {}) {
  const proxy_url = '/api/proxy?url=' + encodeURIComponent(url)
  return fetch(proxy_url, options)
}

/**
 * Fetch and parse JSON from an external URL
 * @param {string} url - The URL to fetch
 * @returns {Promise<any>}
 */
proxy.json = async function(url) {
  const response = await proxy(url)
  if (!response.ok) throw new Error('Failed to fetch: ' + response.status)
  return response.json()
}

/**
 * Fetch text from an external URL
 * @param {string} url - The URL to fetch
 * @returns {Promise<string>}
 */
proxy.text = async function(url) {
  const response = await proxy(url)
  if (!response.ok) throw new Error('Failed to fetch: ' + response.status)
  return response.text()
}

/**
 * Get a proxied URL for use in src attributes (audio, img, etc.)
 * @param {string} url - The original URL
 * @returns {string}
 */
proxy.url = function(url) {
  return '/api/proxy?url=' + encodeURIComponent(url)
}
`.trim()
}

/**
 * @param {string} head
 * @param {string | object} broadcast_id_or_options - broadcast_id string or options object
 * @param {{content?: any[], design?: any[], project_id?: string, data_collections?: string[]}} [options]
 */
export const dynamic_iframe_srcdoc = (head, broadcast_id_or_options, options = {}) => {
  // Support both calling conventions: (head, options) and (head, broadcast_id, options)
  let broadcast_id = '';
  if (typeof broadcast_id_or_options === 'object') {
    options = broadcast_id_or_options;
  } else {
    broadcast_id = broadcast_id_or_options || '';
  }
  const { content = [], design = [], project_id = '', data_collections = [] } = options;

  // Generate Bunny Fonts CDN links for any web fonts in design fields
  const font_links = generate_font_links(design);

  // Generate inline CSS for design variables
  const design_css = generate_design_css(design);

  // Transform content fields into key-value object (images → URLs, markdown → HTML)
  const content_obj = transform_content_fields(content, project_id);

  // Transform design fields into key-value object
  /** @type {Record<string, string>} */
  const design_obj = {};
  for (const field of design) {
    design_obj[field.css_var] = field.value;
  }

  // Create data URLs for import map
  // $content reads from a global so it can be updated without reload
  const content_module = `
window.__tk_content = ${JSON.stringify(content_obj)};
export default window.__tk_content;
`.trim();
  const design_module = `export default ${JSON.stringify(design_obj)}`;
  const data_module = generate_data_module(project_id, data_collections);
  const tk_module = generate_tinykit_module(project_id);
  const content_url = `data:text/javascript,${encodeURIComponent(content_module)}`;
  const design_url = `data:text/javascript,${encodeURIComponent(design_module)}`;
  const data_url = `data:text/javascript,${encodeURIComponent(data_module)}`;
  const tk_url = `data:text/javascript,${encodeURIComponent(tk_module)}`;

  return `
  <!DOCTYPE html>
  <html>
    <head>
      <style id="design-variables">${design_css}</style>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/modern-normalize@2.0.0/modern-normalize.min.css">
      ${font_links}
      <!-- <script src="https://cdn.tailwindcss.com"></script> -->
      <script type="importmap">
      {
        "imports": {
          "svelte": "https://esm.sh/svelte@5",
          "svelte/": "https://esm.sh/svelte@5/",
          "$content": "${content_url}",
          "$design": "${design_url}",
          "$data": "${data_url}",
          "$tinykit": "${tk_url}"
        }
      }
      </script>
      <script type="module">
        let mod;
        let reset;
        let last_rendered_html = '';

        // Listen for messages from parent via postMessage
        window.addEventListener('message', async (e) => {
          const { event, payload = {} } = e.data || {}
          if (!event) return

          // Handle CSS variable injection (no reload needed)
          if (event === 'UPDATE_CSS_VARS') {
            const style = document.getElementById('design-variables')
            if (style) style.textContent = payload.css
            return
          }

          // Handle realtime data updates
          if (event === 'DATA_UPDATED') {
            if (payload.data && typeof window.__tk_update_data === 'function') {
              window.__tk_update_data(payload.data)
            }
            return
          }

          // Handle content updates (remount component with new content)
          if (event === 'UPDATE_CONTENT') {
            if (payload.content && window.__tk_content) {
              // Mutate existing object so cached module reference stays valid
              for (const key in window.__tk_content) delete window.__tk_content[key]
              Object.assign(window.__tk_content, payload.content)
              // Remount component to pick up new content
              if (mod) update({})
            }
            return
          }

          // Handle clearing the app (e.g., on reset)
          if (event === 'CLEAR_APP') {
            if (reset) {
              try { reset() } catch (_) {}
              reset = null
            }
            mod = null
            document.body.innerHTML = ''
            last_rendered_html = ''
            return
          }

          // Handle font link injection
          if (event === 'UPDATE_FONTS') {
            const fonts = payload.fonts || []
            // Find existing font links (check both data attribute and href for bunny fonts)
            const existing_fonts = new Set()
            document.querySelectorAll('link[data-bunny-font]').forEach(link => {
              existing_fonts.add(link.getAttribute('data-bunny-font'))
            })
            document.querySelectorAll('link[href*="fonts.bunny.net"]').forEach(link => {
              // Extract font names from existing hrefs
              const href = link.getAttribute('href') || ''
              const match = href.match(/family=([^&]+)/)
              if (match) {
                const family_str = decodeURIComponent(match[1])
                family_str.split('|').forEach(f => {
                  const font_name = f.split(':')[0].replace(/-/g, ' ')
                  existing_fonts.add(font_name)
                  // Also add the slug version
                  existing_fonts.add(f.split(':')[0])
                })
              }
            })

            // Add new font links
            for (const font of fonts) {
              const slug = font.toLowerCase().replace(/\\s+/g, '-')
              // Check both the font name and its slug version
              if (!existing_fonts.has(font) && !existing_fonts.has(slug)) {
                const link = document.createElement('link')
                link.rel = 'stylesheet'
                link.setAttribute('data-bunny-font', font)
                link.href = 'https://fonts.bunny.net/css?family=' + encodeURIComponent(slug + ':400,500,600,700') + '&display=swap'
                document.head.appendChild(link)
              }
            }
            return
          }

          if (payload.componentApp) {
            await init(payload.componentApp)
            // After init, automatically mount the component with provided data
            if (payload.data !== undefined) {
              update(payload.data)
            }
          } else if (payload.data) {
            // Update existing component
            update(payload.data)
          }
        })
        window.parent.postMessage({ event: 'INITIALIZED' }, '*');

        // Send periodic heartbeat to parent so it knows we're not frozen
        setInterval(() => {
          try { window.parent.postMessage({ event: 'HEARTBEAT' }, '*'); } catch (_) {}
        }, 500);

        // Capture runtime errors (not just mount errors)
        window.addEventListener('error', (e) => {
          const error_message = e.error ? e.error.toString() : e.message || 'Unknown runtime error'
          try {
            window.parent.postMessage({
              event: 'SET_ERROR',
              payload: { error: error_message }
            }, '*')
          } catch (_) {}
          e.preventDefault() // Prevent default browser error display
        })

        // Capture unhandled promise rejections
        window.addEventListener('unhandledrejection', (e) => {
          const error_message = e.reason ? e.reason.toString() : 'Unhandled promise rejection'
          try {
            window.parent.postMessage({
              event: 'SET_ERROR',
              payload: { error: error_message }
            }, '*')
          } catch (_) {}
          e.preventDefault()
        })

        async function init(source) {
          const blob = new Blob([source], { type: 'text/javascript' })
          const url = URL.createObjectURL(blob)
          await import(url)
            .then((module) => {
              mod = module
            })
            .finally(() => {
              try { URL.revokeObjectURL(url) } catch (_) {}
            });
        }

        function update(props) {
          // Reset runtime error display in parent
          try { window.parent.postMessage({ event: 'BEGIN' }, '*'); } catch (_) {}

          // Reset log tracking for this render
          logsThisRender = false;

          const previous_html = document.body.innerHTML;
          document.body.innerHTML = '';

          if (reset) {
            try { reset() } catch (_) {}
            reset = null;
          }

          try {
            const component = mod.mount(mod.default, {
              target: document.body
            })
            const { unmount } = mod
            reset = () => unmount(component)
            last_rendered_html = document.body.innerHTML;
            window.parent.postMessage({ event: 'MOUNTED' }, '*')
            // After enough time for console logs to be called and sent, check if any were produced
            // Wait longer than the throttle delay (120ms) to ensure any mount-time logs are sent first
            setTimeout(() => {
              if (!logsThisRender) {
                try { window.parent.postMessage({ event: 'SET_CONSOLE_LOGS', payload: { logs: null } }, '*'); } catch (_) {}
              }
            }, 300)
          } catch(e) {
            reset = null;
            if (last_rendered_html) {
              document.body.innerHTML = last_rendered_html;
            } else {
              document.body.innerHTML = previous_html;
            }
            window.parent.postMessage({
              event: 'SET_ERROR',
              payload: {
                error: e.toString()
              }
            }, '*');
          }
        }

        // Virtual location for srcdoc iframes
        // Tracks pathname/search/hash so routing libraries work correctly
        const virtualLocation = {
          pathname: '/',
          search: '',
          hash: location.hash || '',
          get href() {
            return this.pathname + this.search + this.hash;
          }
        };

        // Parse URL into virtual location parts
        function parseUrl(url) {
          if (!url || typeof url !== 'string') return;
          const hashIdx = url.indexOf('#');
          const searchIdx = url.indexOf('?');

          let pathname = url;
          let search = '';
          let hash = '';

          if (hashIdx !== -1) {
            hash = url.slice(hashIdx);
            pathname = url.slice(0, hashIdx);
          }
          if (searchIdx !== -1 && (hashIdx === -1 || searchIdx < hashIdx)) {
            search = hashIdx !== -1 ? url.slice(searchIdx, hashIdx) : url.slice(searchIdx);
            pathname = url.slice(0, searchIdx);
          }

          return { pathname: pathname || '/', search, hash };
        }

        // Patch History API to update virtual location and dispatch popstate with path in state
        history.pushState = (state, title, url) => {
          const parsed = parseUrl(url);
          if (parsed) {
            Object.assign(virtualLocation, parsed);
            if (parsed.hash) {
              try { location.hash = parsed.hash; } catch(e) {}
            }
          }
          window.dispatchEvent(new PopStateEvent('popstate', {
            state: { ...state, path: parsed?.pathname || '/' }
          }));
        };

        history.replaceState = (state, title, url) => {
          const parsed = parseUrl(url);
          if (parsed) {
            Object.assign(virtualLocation, parsed);
            if (parsed.hash) {
              try { location.hash = parsed.hash; } catch(e) {}
            }
          }
        };

        // Intercept internal link clicks for SPA navigation
        document.addEventListener('click', (e) => {
          const a = e.target.closest('a');
          if (!a) return;
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          if (a.target === '_blank' || a.hasAttribute('download')) return;

          const href = a.getAttribute('href');
          if (!href) return;
          if (href.startsWith('http://') || href.startsWith('https://')) return;
          if (href.startsWith('mailto:') || href.startsWith('tel:')) return;

          e.preventDefault();
          history.pushState({}, '', href);
        });

        // Install a safe console proxy that forwards logs to the parent
        let logsThisRender = false;
        (function setupConsoleBridge(){
          try {
            const methods = ['log','info','warn','error'];
            const original = Object.create(null);
            for (const m of methods) {
              const fn = (console && typeof console[m] === 'function') ? console[m].bind(console) : null;
              original[m] = fn;
            }

            const safeSerialize = (v) => {
              try { return JSON.parse(JSON.stringify(v)); } catch (_) { return typeof v === 'string' ? v : String(v); }
            };

            let timer = null;
            let lastQueued = undefined;
            let lastSent = undefined;
            const sendThrottled = (value) => {
              lastQueued = value;
              logsThisRender = true;
              if (timer) return;
              timer = setTimeout(() => {
                timer = null;
                const payload = lastQueued;
                const key = (()=>{ try { return JSON.stringify(payload);} catch(_) { return String(payload);} })();
                if (key !== lastSent) {
                  try { window.parent.postMessage({ event: 'SET_CONSOLE_LOGS', payload: { logs: payload } }, '*'); } catch(_) {}
                  lastSent = key;
                }
              }, 120);
            };

            for (const m of methods) {
              console[m] = (...args) => {
                try {
                  const payload = args.length <= 1 ? safeSerialize(args[0]) : args.map(safeSerialize);
                  sendThrottled(payload);
                } catch(_) {}
                if (original[m]) try { original[m](...args); } catch(_) {}
              };
            }
          } catch(_) {
            // ignore logging bridge failures
          }
        })();
		  </script>
    </head>
    <body></body>
  </html>
`;
};

/**
 * @param {{ head?: string, html: string, css: string, foot?: string }} params
 */
export const static_iframe_srcdoc = ({ head = "", html, css, foot = "" }) => {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${head}
      </head>
      <body id="page" style="margin:0">
        ${html}
        <style>${css}</style>
        ${foot}
      </body>
    </html>
  `;
};
