import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeAtomic } from './workspace.mjs';

/** Caller holds hosted.lock. A lost response must retry this frozen creation. */
export async function bootstrapHostedApp(root, config, server, request) {
  if (!config.local_first || !['private', 'public'].includes(config.visibility))
    throw Error('This workspace needs an explicit visibility before its first publication.');
  const path = join(root, '.tinykit/creation.json');
  let attempt;
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw Error('The creation state must not be a symbolic link.');
    attempt = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (attempt) {
    if (attempt.server !== server || attempt.project_id !== config.project_id)
      throw Error(
        'Creation was already attempted for another server or app. Check that outcome before choosing another target.'
      );
    if (attempt.intent?.visibility !== config.visibility)
      throw Error(
        'App access changed after creation was requested. Review the original target before publishing.'
      );
  } else {
    attempt = {
      server,
      project_id: config.project_id,
      intent: { creation_id: randomUUID(), name: config.name, visibility: config.visibility }
    };
    await writeAtomic(path, attempt);
  }
  let result;
  try {
    result = await request('/create', attempt.intent);
  } catch (error) {
    if (!error.status) {
      const unknown = new Error(
        'Hosted creation outcome is unknown. Retry publication with the same folder and server to recover this exact app. Local records remain here.'
      );
      unknown.creation = { state: 'unknown', project_id: config.project_id };
      throw unknown;
    }
    throw error;
  }
  if (
    result.protocol !== 1 ||
    result.project_id !== config.project_id ||
    result.creation_id !== attempt.intent.creation_id ||
    result.visibility !== config.visibility ||
    !/^[a-f0-9]{64}$/.test(result.base_revision || '') ||
    result.draft_revision !== null
  )
    throw Error(
      'The server returned a different creation identity or unsupported result. No baseline was accepted.'
    );
  return {
    server,
    project_id: config.project_id,
    base_revision: result.base_revision,
    draft_revision: null
  };
}
