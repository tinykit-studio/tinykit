// Existing app bundles may assume localStorage is always available. This
// fallback lives entirely in the sandboxed document and dies with the page.
// It never reads host storage, uses cookies, or communicates with other pages.
const fallback = `<script data-tinykit-legacy-storage>
(() => {
  try { if (window.localStorage) return; } catch {}
  const items = new Map();
  const storage = {
    get length() { return items.size; },
    key(index) { return Array.from(items.keys())[index >>> 0] ?? null; },
    getItem(key) { return items.get(String(key)) ?? null; },
    setItem(key, value) { items.set(String(key), String(value)); },
    removeItem(key) { items.delete(String(key)); },
    clear() { items.clear(); }
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
})();
</script>`;

/** @param {string} html */
export function withLegacyBrowserStorage(html) {
  // Keep the original doctype first and run before any code in the old build.
  const doctype = html.match(/^\s*<!doctype\s+html\s*>/i)?.[0] || '';
  return doctype + fallback + html.slice(doctype.length);
}
