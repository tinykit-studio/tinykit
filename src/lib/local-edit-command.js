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

/** @param {string} projectId @param {string} origin */
export function localEditPrompt(projectId, origin) {
  const command = localEditCommand(projectId, origin, true);
  const server = new URL(origin).origin;
  return [
    'Set up this Tinykit app for local editing in this chat.',
    '',
    `Tinykit server: ${server}`,
    `App ID: ${projectId}`,
    '',
    'Use Node 22+ and a local checkout of https://github.com/tinykit-studio/tinykit. Reuse a checkout if available. Run npm ci if its dependencies are missing.',
    'Reuse an existing app folder only if its tinykit.json matches both the server and app ID. Keep any local edits intact.',
    `From the Tinykit checkout, run: ${command} --no-agent`,
    `If Tinykit asks me to sign in, pause and give me this command to run in my terminal, replacing YOUR_EMAIL with my Tinykit email: npm run tinykit -- login --server ${server} --email YOUR_EMAIL`,
    'Let me enter my password in the terminal. Never ask me to paste credentials into chat.',
    'Once the local preview is ready, tell me its URL and the path to the app files. If you cannot start a local preview, give me the command to run myself.',
    'Wait for my instructions before editing app files or publishing.'
  ].join('\n');
}
