import { generate_font_links } from './fonts.js'

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
      const record_data = data.id ? data : { ...data, id: crypto.randomUUID().slice(0, 8) }
      const res = await fetch(base_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record_data)
      })
      if (!res.ok) throw new Error(await res.text())
      const record = await res.json()
      // Set cooldown to ignore echo from our own mutation
      collection._set_cooldown(500)
      // Optimistically update local cache
      if (cache) {
        cache = [...cache, record]
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
          cache = cache.map(r => r.id === id ? { ...r, ...data, updated: new Date().toISOString() } : r)
          collection._notify(cache, true)
        }
      }
      const res = await fetch(\`\${base_url}/\${id}\`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
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

const db = {
${collection_entries}
}

export default db
`.trim()
}

/**
 * Generate the $tinykit module code (tinykit utilities)
 * @returns {string}
 */
const generate_tinykit_module = () => {
  return `
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
 * @param {string} broadcast_id
 * @param {{content?: any[], design?: any[], project_id?: string, data_collections?: string[]}} [options]
 */
export const dynamic_iframe_srcdoc = (head, broadcast_id, options = {}) => {
  const { content = [], design = [], project_id = '', data_collections = [] } = options;

  // Generate Bunny Fonts CDN links for any web fonts in design fields
  const font_links = generate_font_links(design);

  // Generate inline CSS for design variables
  const design_css = generate_design_css(design);

  /**
   * @param {string} text
   */
  const slugify = (text) => {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  };

  // Transform content fields into key-value object
  /** @type {Record<string, any>} */
  const content_obj = {};
  for (const field of content) {
    const key = slugify(field.name);
    content_obj[key] = field.value;
  }

  // Transform design fields into key-value object
  /** @type {Record<string, string>} */
  const design_obj = {};
  for (const field of design) {
    design_obj[field.css_var] = field.value;
  }

  // Create data URLs for import map
  const content_module = `export default ${JSON.stringify(content_obj)}`;
  const design_module = `export default ${JSON.stringify(design_obj)}`;
  const data_module = generate_data_module(project_id, data_collections);
  const tk_module = generate_tinykit_module();
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

        const channel = new BroadcastChannel('${broadcast_id}');
        channel.onmessage = async ({data}) => {
          const { event, payload = {} } = data

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
        }
        channel.postMessage({ event: 'INITIALIZED' });

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
          try { channel.postMessage({ event: 'BEGIN' }); } catch (_) {}

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
            channel.postMessage({ event: 'MOUNTED' })
            // After enough time for console logs to be called and sent, check if any were produced
            // Wait longer than the throttle delay (120ms) to ensure any mount-time logs are sent first
            setTimeout(() => {
              if (!logsThisRender) {
                try { channel.postMessage({ event: 'SET_CONSOLE_LOGS', payload: { logs: null } }); } catch (_) {}
              }
            }, 300)
          } catch(e) {
            reset = null;
            if (last_rendered_html) {
              document.body.innerHTML = last_rendered_html;
            } else {
              document.body.innerHTML = previous_html;
            }
            channel.postMessage({
              event: 'SET_ERROR',
              payload: {
                error: e.toString()
              }
            });
          }
        }

        // Patch History API for srcdoc iframes (pushState/replaceState throw in srcdoc)
        // Hash-based URLs work via location.hash, path-based URLs are silently ignored
        history.pushState = (state, title, url) => {
          try {
            if (url && typeof url === 'string') {
              const hashIndex = url.indexOf('#');
              if (hashIndex !== -1) {
                location.hash = url.slice(hashIndex);
              }
              // Path-only URLs silently ignored (can't navigate in srcdoc)
            }
          } catch (e) {
            // Silently ignore any errors
          }
        };

        history.replaceState = (state, title, url) => {
          try {
            if (url && typeof url === 'string') {
              const hashIndex = url.indexOf('#');
              if (hashIndex !== -1) {
                location.hash = url.slice(hashIndex);
              }
            }
          } catch (e) {
            // Silently ignore any errors
          }
        };

        // Intercept hash link clicks to keep navigation within iframe
        document.addEventListener('click', (e) => {
          const link = e.target.closest('a[href^="#"]');
          if (link) {
            e.preventDefault();
            location.hash = link.getAttribute('href');
          }
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
                  try { channel.postMessage({ event: 'SET_CONSOLE_LOGS', payload: { logs: payload } }); } catch(_) {}
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
