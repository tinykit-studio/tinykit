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

/** @param {string} projectId @param {string} origin @param {string} [previewBranch] */
export function localEditPrompt(projectId, origin, previewBranch = '') {
  const command = localEditCommand(projectId, origin, true);
  const server = new URL(origin).origin;
  const repository = 'https://github.com/tinykit-studio/tinykit';
  const branch = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(previewBranch) ? previewBranch : '';
  return [
    'Set up this Tinykit app for local editing in this chat.',
    '',
    `Tinykit server: ${server}`,
    `App ID: ${projectId}`,
    '',
    'Use Node 22+.',
    ...(branch ? [
      `This staging build needs an up-to-date checkout of the Tinykit ${branch} branch. Reuse a checkout only if it is already on that branch and up to date.`,
      `Otherwise, from a writable folder, clone it into a new directory: git clone --branch ${branch} --single-branch ${repository}.git`,
      'Leave any existing checkout and local changes intact.'
    ] : [`Use a local checkout of ${repository}. Reuse a checkout if available.`]),
    'From the Tinykit checkout, run npm ci if dependencies are missing.',
    'Set APP_DIR to an absolute path inside this chat’s writable workspace, outside the Tinykit checkout. Reuse an app folder there only if its tinykit.json matches both the server and app ID. Keep any local edits intact.',
    `Otherwise, choose a new path such as tinykit-app-${projectId} under the workspace root. Let Tinykit create the app folder.`,
    `From the Tinykit checkout, run: ${command} --directory "$APP_DIR" --no-agent`,
    `If Tinykit asks me to sign in, pause and give me this command to run in my terminal, replacing YOUR_EMAIL with my Tinykit email: npm run tinykit -- login --server ${server} --email YOUR_EMAIL`,
    'Let me enter my password in the terminal. Never ask me to paste credentials into chat. Wait for me to confirm sign-in, then retry the edit command.',
    'Once the local preview is ready, tell me its URL and the path to the app files. If you cannot start a local preview, give me the command to run myself.',
    'Wait for my instructions before editing app files or publishing.'
  ].join('\n');
}
