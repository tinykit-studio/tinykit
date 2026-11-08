/** @param {string} projectId @param {string} origin @param {boolean} [fromCheckout] */
export function localEditCommand(projectId, origin, fromCheckout = false) {
  if (!/^[a-z0-9]{15}$/.test(projectId)) throw new Error('Choose a saved app before editing locally.');
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the Tinykit server address to edit this app.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Your Tinykit server needs HTTPS for local editing.');
  const quoted = "'" + url.origin.replaceAll("'", "'\\''") + "'";
  const cli = fromCheckout ? 'npm run tinykit --' : 'tinykit';
  return `${cli} edit ${projectId} --server ${quoted}`;
}

/** The link carries identity only; the registered folder stays on this Mac.
 * @param {string} projectId @param {string} origin */
export function localEditLink(projectId, origin) {
  localEditCommand(projectId, origin);
  const link = new URL('tinykit://edit');
  link.searchParams.set('server', new URL(origin).origin);
  link.searchParams.set('project', projectId);
  return link.href;
}
