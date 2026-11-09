// Private JSON bridge for the local companion. Never accepts a workspace from HTTP.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostedCommand, serverOrigin } from './hosted.mjs';
import { readWorkspaceFile, writeAtomic } from './workspace.mjs';

// The web UI uses origin-bound saved credentials, never ambient CLI tokens.
delete process.env.TINYKIT_TOKEN;
delete process.env.TINYKIT_TOKEN_FILE;

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 20000) throw new Error('Request too large.');
}
try {
  const { action, ...values } = JSON.parse(input);
  const directory = process.env.TINYKIT_COMPANION_DIR;
  if (!directory) throw new Error('Local companion is unavailable.');
  let saved;
  try { saved = JSON.parse(await readFile(join(directory, '.tinykit/connection.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const config = JSON.parse((await readWorkspaceFile(directory, 'tinykit.json')).toString('utf8'));
  if (!saved) {
    try { saved = JSON.parse(await readFile(join(directory, '.tinykit/remote.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  saved ||= config.hosted;
  if (action === 'connection') {
    console.log(JSON.stringify({ ok: true, server: saved?.server || '', project_id: saved?.project_id || config.project_id }));
  } else {
    if (!['connect', 'review', 'link', 'push', 'publish'].includes(action)) throw new Error('Unknown companion action.');
    const options = { directory, server: saved?.server, project: saved?.project_id };
    let connectedReview;
    if (action === 'connect') {
      options.server = serverOrigin(values.server);
      options.project = values.project_id;
      if (!/^[a-z0-9]{15}$/.test(options.project || '')) throw new Error('Enter a 15-character project ID.');
      if (values.email) {
        if (typeof values.password !== 'string' || !values.password) throw new Error('Enter your Tinykit password.');
        options.email = values.email;
        options.password = values.password;
      }
      await hostedCommand('login', options);
      connectedReview = await hostedCommand('review', options);
      await writeAtomic(join(directory, '.tinykit/connection.json'), { server: options.server, project_id: options.project });
    } else if (['link', 'push', 'publish'].includes(action)) {
      if (!values.review || typeof values.review.local_revision !== 'string' || typeof values.review.base_revision !== 'string') throw new Error('Review the current changes first.');
      options.review = values.review;
      options.publish = action === 'push' && values.publish === true;
    }
    const result = connectedReview || await hostedCommand(action, options);
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message, ...(error.push ? { push: error.push } : {}), ...(error.publish ? { publish: error.publish } : {}) }));
}
