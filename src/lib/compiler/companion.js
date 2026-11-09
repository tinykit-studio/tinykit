// The companion preview has an opaque origin, separating app code from login
// and publish controls. Its capability is valid only for this app's local data.
/** @param {any} value @param {string} projectId @param {string} capability @returns {any} */
export function companionAssetReferences(value, projectId, capability) {
  if (!capability) return value;
  if (typeof value === 'string') return value.replace(new RegExp('/_tk/assets/' + projectId + '/[^\\s"\'`<>)}]+', 'g'), path => {
    const url = new URL(path, 'http://preview.local');
    url.searchParams.set('_preview', capability);
    return url.pathname + url.search;
  });
  if (Array.isArray(value)) return value.map(item => companionAssetReferences(item, projectId, capability));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, companionAssetReferences(item, projectId, capability)]));
  return value;
}

/** @param {string} html @param {string} projectId @param {string} capability */
export function isolateCompanionPreview(html, projectId, capability) {
  const script = `
    const scope = ${JSON.stringify(projectId)};
    const capability = ${JSON.stringify(capability)};
    function scopedURL(input) {
      const url = new URL(input, document.baseURI);
      const prefix = '/_tk/';
      if (url.origin === new URL(document.baseURI).origin &&
          (url.pathname.startsWith(prefix + 'data/' + scope + '/') ||
           url.pathname === prefix + 'realtime/' + scope ||
           url.pathname.startsWith(prefix + 'assets/' + scope + '/'))) url.searchParams.set('_preview', capability);
      return url.href;
    }
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, options) => originalFetch(input instanceof Request ? new Request(scopedURL(input.url), input) : scopedURL(input), options);
    const OriginalEventSource = window.EventSource;
    window.EventSource = class extends OriginalEventSource {
      constructor(url, options) { super(scopedURL(url), options); }
    };
  `;
  return html.replace('<head>', '<head><script>' + script + '</scr' + 'ipt>');
}
