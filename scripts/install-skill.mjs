import { cp, readFile, writeFile, mkdir, lstat, realpath, access, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
async function rejectLinks(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink())
    throw Error(
      'The managed Tinykit skill contains a symbolic link. Choose a different directory.'
    );
  if (info.isDirectory())
    for (const name of await readdir(path)) await rejectLinks(join(path, name));
}
export function parseSkillArgs(args) {
  if (args[0] !== 'install')
    throw Error('Usage: tinykit skill install [--directory <skills-directory>] [--json]');
  const options = {
    directory: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills'),
    json: false
  };
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--directory' && args[i + 1] && !args[i + 1].startsWith('--'))
      options.directory = resolve(args[++i]);
    else if (args[i] === '--json') options.json = true;
    else throw Error(`Unknown skill install argument: ${args[i]}`);
  }
  return options;
}
export async function installSkill(options) {
  let directory = resolve(options.directory);
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink())
    throw Error('Choose a skills directory without symbolic links.');
  directory = await realpath(directory);
  const target = join(directory, 'tinykit');
  let exists = false;
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw Error('The Tinykit skill destination must not be a link.');
    exists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (exists) {
    let marker;
    try {
      marker = JSON.parse(await readFile(join(target, 'runtime.json'), 'utf8'));
    } catch {}
    if (marker?.managed_by !== 'tinykit')
      throw Error(
        'A Tinykit skill already exists here and was not installed by Tinykit. Choose another directory to preserve it.'
      );
    await rejectLinks(target);
  }
  await mkdir(target, { recursive: true });
  for (const name of ['SKILL.md', 'agents', 'references', 'scripts'])
    await cp(join(packageRoot, 'skills/tinykit', name), join(target, name), {
      recursive: true,
      force: true
    });
  await writeFile(
    join(target, 'runtime.json'),
    JSON.stringify(
      {
        managed_by: 'tinykit',
        node: process.execPath,
        entrypoint: join(packageRoot, 'scripts/tinykit.mjs')
      },
      null,
      2
    ) + '\n'
  );
  await access(join(target, 'SKILL.md'));
  return {
    ok: true,
    directory: target,
    skill: join(target, 'SKILL.md'),
    message: `Installed the Tinykit skill at ${target}. Start a new agent chat to discover it, or load that SKILL.md explicitly. Keep this Tinykit checkout and Node installation in place.`
  };
}
