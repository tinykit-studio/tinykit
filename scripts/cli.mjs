import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseHostedArgs } from './companion/hosted.mjs';
import { login, logout, defaultServer } from './companion/auth.mjs';
import { componentConfig, componentCommand, componentStatus, startComponentDev } from './static-project/cli.mjs';

export const usage = `Tinykit local development

  tinykit create <new-directory> [--template blank|crm|project-tracker] [--name <name>] [--public] [--json]
  tinykit start [apps-directory] [--server <origin>] [--port <port>] [--no-open]
  tinykit login [directory] --server <origin> --email <email>
  tinykit logout [--server <origin>]
  tinykit export <project-id> <new-directory> [--server <origin>] [--include-records]
  tinykit export <export.json> <new-directory> [--svelte] [--server <origin>]
  tinykit dev [directory] [--port <port>] [--no-open] [--app-only]
  tinykit skill install [--directory <skills-directory>] [--json]
  tinykit edit [directory|project-id] [--server <origin>] [--directory <folder>] [--json]
  tinykit launcher install [--json]  (macOS; one-time Studio button setup)
  tinykit stop [directory] [--json]
  tinykit publish [directory] [--json]
  tinykit status [directory] [--json]
  tinykit check [directory] [--json]
  tinykit remote-status [directory] [--json]

Single-file companion projects also support:
  tinykit link [directory] --server <origin> [--project <id>]
  tinykit push [directory] [--publish] [--json]

Sign in once per server. Direct server exports create normal Svelte/Vite projects.
Install dependencies in the exported folder, then use dev and publish there.
Source JSON exports retain the companion format unless they contain a source
bundle or --svelte is selected. Export also accepts --include-assets for legacy apps.
Use --json on export, login, publish, check, and status for machine-readable results.
Requires an installed Tinykit checkout; Svelte project commands require Node 22+.
`;

function print(result, json) { console.log(json ? JSON.stringify(result, null, 2) : result.message || JSON.stringify(result, null, 2)); }
export async function run(args) {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === '-h') return console.log(usage);
  if (command === 'create') {
    const { parseCreateArgs, createProject } = await import('./create-project.mjs');
    const options=parseCreateArgs(rest);
    return print(await createProject(options),options.json);
  }
  if (command === 'skill') {
    const { parseSkillArgs, installSkill } = await import('./install-skill.mjs');
    const options=parseSkillArgs(rest);
    return print(await installSkill(options),options.json);
  }
  if (command === 'start') {
    const { parseStartArgs, startLauncher } = await import('./companion/launch.mjs');
    return startLauncher(parseStartArgs(rest));
  }
  if (command === 'export') {
    const { parseExportArgs, exportProject } = await import('./export-project.mjs');
    const options = parseExportArgs(rest);
    return print(await exportProject(options), options.json);
  }
  if (command === 'edit') {
    const { parseEditArgs, editProject } = await import('./edit-project.mjs');
    const options = parseEditArgs(rest);
    return print(await editProject(options), options.json);
  }
  if (command === 'launcher') {
    if (rest[0] !== 'install' || rest.slice(1).some(arg => arg !== '--json') || rest.length > 2) throw new Error('Usage: tinykit launcher install [--json]');
    const { installLauncher } = await import('./local-launcher.mjs');
    return print(await installLauncher(), rest.includes('--json'));
  }
  if (command === 'open-url') {
    if (rest.length !== 2 || rest[1] !== '--json') throw new Error('The local launcher accepts one Tinykit link.');
    const { openLocalEditLink } = await import('./local-launcher.mjs');
    return print(await openLocalEditLink(rest[0]), true);
  }
  if (command === 'login' || command === 'logout') {
    const options = parseHostedArgs(rest);
    if (options.publish || options.project) throw new Error('Login takes --server and --email only.');
    const root = resolve(options.directory);
    let config;
    if (!options.server) try { config = JSON.parse(await readFile(join(root, 'tinykit.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const server = options.server || config?.server || config?.hosted?.server || await defaultServer();
    if (!server) throw new Error('Choose a server: tinykit login --server <origin> --email <email>.');
    return print(command === 'login' ? await login({ ...options, root, server }) : await logout(server), options.json);
  }
  if (command === 'dev') {
    let directory = '.', port, open = true, hasDirectory = false, editor = false, appOnly = false;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--port') port = Number(rest[++i]);
      else if (rest[i] === '--no-open') open = false;
      else if (rest[i] === '--editor') editor = true; // Older default; the editor now opens without it.
      else if (rest[i] === '--app-only') appOnly = true;
      else if (rest[i].startsWith('-') || hasDirectory) throw new Error(`Unknown argument: ${rest[i]}`);
      else { directory = rest[i]; hasDirectory = true; }
    }
    if (port !== undefined && (!Number.isInteger(port) || port < 1024 || port > 65535)) throw new Error('--port must be between 1024 and 65535.');
    const root = resolve(directory), component = await componentConfig(root);
    if (component) {
      if(editor)throw new Error('--editor is available for single-component Tinykit apps.');
      // Svelte projects only have the app view, so --app-only needs no handling.
      return startComponentDev(component.root, { port: port ?? 5180, open });
    }
    const { startCompanion } = await import('./companion/dev.mjs');
    if (editor && appOnly) throw new Error('Choose --editor or --app-only, not both.');
    return startCompanion(root, { port, open, appOnly });
  }
  if (command === 'check' || command === 'status' || command === 'stop') {
    const paths = rest.filter(arg => arg !== '--json');
    if (paths.length > 1 || paths.some(arg => arg.startsWith('-'))) throw new Error(`Usage: tinykit ${command} [directory] [--json]`);
    const root = resolve(paths[0] || '.'), component = await componentConfig(root);
    if (command === 'stop') {
      if (!component) throw new Error('tinykit stop supports exported Svelte previews. Stop a single-file companion with Ctrl+C in its terminal.');
      const { stopEditPreview } = await import('./edit-project.mjs');
      return print(await stopEditPreview(component), rest.includes('--json'));
    }
    if (command === 'check') {
      const result = component ? await (await import('./static-project/check.mjs')).checkProject(component.root) : await (await import('./companion/check.mjs')).checkWorkspace(root);
      print(result, rest.includes('--json'));
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (component) {
      const status = await componentStatus(component.root);
      return print({ ...status, message: `${status.running ? 'Running' : 'Stopped'} · Svelte project · ${status.source_files} source files · build ${status.build.state}${status.url ? '\n' + status.url : ''}` }, rest.includes('--json'));
    }
    const { readStatus } = await import('./companion/status.mjs');
    const status = await readStatus(root);
    return print({ ...status, message: `${status.running === null ? 'Runtime state unavailable' : status.running ? 'Running' : 'Stopped'} · revision ${status.revision} · compilation ${status.compile.state}\n${status.compile.error || status.compile.message || status.url || ''}` }, rest.includes('--json'));
  }
  if (['link', 'push', 'publish', 'remote-status'].includes(command)) {
    const options = parseHostedArgs(rest);
    if (options.publish && command !== 'push') throw new Error('--publish is supported with tinykit push only.');
    const component = await componentConfig(resolve(options.directory));
    if (component) return print(await componentCommand(command, component, options), options.json);
    const { hostedCommand } = await import('./companion/hosted.mjs');
    // Only the agent-facing CLI shortcut means "publish current files".
    // The companion's separate publish action still activates its saved draft.
    const config = JSON.parse(await readFile(join(resolve(options.directory), 'tinykit.json'), 'utf8'));
    const publishCurrent = command === 'publish' && config.local_first === true;
    const result = await hostedCommand(publishCurrent ? 'push' : command, publishCurrent ? { ...options, publish: true } : options);
    print(result, options.json);
    if (!options.json && result.publish?.state === 'succeeded' && result.public_url) console.log(result.public_url);
    return;
  }
  throw new Error(`Unknown command: ${command}\n${usage}`);
}
