import { readFile, writeFile } from 'node:fs/promises';
import { resolve, basename, join, relative, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exportWorkspace } from './companion/workspace.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
// Shell-quote only when needed so the printed next step reads like a normal command.
const shellPath = (value) => (/^[\w./~-]+$/.test(value) ? value : quote(value));
const names = {
  blank: null,
  crm: 'personal-crm',
  'personal-crm': 'personal-crm',
  'project-tracker': 'project-tracker'
};

export function parseCreateArgs(args) {
  const options = { template: 'blank', visibility: 'private', json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--template', '--name'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`${arg} needs a value.`);
      options[arg.slice(2)] = args[++i];
    } else if (arg === '--public') options.visibility = 'public';
    else if (arg === '--json') options.json = true;
    else if (arg.startsWith('-') || options.directory)
      throw Error(`Unknown create argument: ${arg}`);
    else options.directory = arg;
  }
  if (!options.directory)
    throw Error(
      'Usage: tinykit create <new-directory> [--template blank|crm|project-tracker] [--name <name>] [--public] [--json]'
    );
  if (!Object.hasOwn(names, options.template))
    throw Error('Choose --template blank, crm, or project-tracker.');
  return options;
}

export async function createProject(options) {
  if (Number(process.versions.node.split('.')[0]) < 22)
    throw Error('Creating a Tinykit app requires Node.js 22 or newer.');
  const directory = resolve(options.directory);
  const name = (options.name || basename(directory).replace(/[-_]+/g, ' ')).trim();
  if (!name || name.length > 100 || /[\x00-\x1f]/.test(name))
    throw Error('Choose an app name between 1 and 100 characters.');
  if (
    !Object.hasOwn(names, options.template) ||
    !['private', 'public'].includes(options.visibility)
  )
    throw Error('Invalid app template or visibility.');
  const template = names[options.template]
    ? JSON.parse(
        await readFile(
          join(packageRoot, `src/lib/templates/${names[options.template]}.json`),
          'utf8'
        )
      )
    : {
        frontend_code:
          '<script>\n  import content from "$content"\n</script>\n\n<main>\n  <h1>{content.title}</h1>\n  <p>Your app is ready to build.</p>\n</main>\n\n<style>\n  :global(body) { margin: 0; font-family: system-ui, sans-serif; color: #1f2937; background: #f8fafc; }\n  main { max-width: 960px; margin: 64px auto; padding: 24px; }\n</style>\n',
        content: [
          { id: 'title', name: 'Title', type: 'text', value: name, description: 'App title' }
        ],
        design: [],
        data: {},
        preview_records: {}
      };
  const project = {
    ...template,
    id: randomBytes(10).toString('hex').slice(0, 15),
    name,
    visibility: options.visibility,
    local_first: true
  };
  const formatGuide = await readFile(
    join(packageRoot, 'skills/tinykit/references/app-format.md'),
    'utf8'
  );
  project.content = structuredClone(template.content || []);
  const title = project.content.find((field) => field.name.toLowerCase() === 'title');
  if (title) title.value = name;
  // Source templates and local examples are distinct. No server is contacted and
  // no hosted identity, credential, or data is needed to create the workspace.
  project.data = Object.fromEntries(
    Object.entries(template.data || {}).map(([collection, value]) => [
      collection,
      { ...value, records: [] }
    ])
  );
  await exportWorkspace(project, directory);
  await writeFile(
    join(directory, 'seeds.json'),
    JSON.stringify(template.preview_records || {}, null, 2) + '\n'
  );
  const cli = `${quote(process.execPath)} ${quote(join(packageRoot, 'scripts/tinykit.mjs'))}`;
  await writeFile(
    join(directory, 'AGENTS.md'),
    `# Tinykit app\n\nUse Svelte 5 in App.svelte. This is Tinykit's single-component format: keep application logic in this file rather than creating a SvelteKit server or a second app scaffold. Read instructions.md and TINYKIT.md for this app's requirements and the data API.\n\nSource files are App.svelte, content.json, design.json, schema.json, and flat assets/. Collection names in schema.json generate the $data API. Use Svelte runes for reactive state. Content imports use normalized field names, for example a field named “Title” becomes content.title.\n\n## Commands\n\nThe CLI used to create this app is available through this exact command:\n\n\`\`\`sh\n${cli} dev . --no-open\n${cli} check . --json\n${cli} status . --json\n\`\`\`\n\nStart one dev process and use the printed app preview URL. It stays running while you work; the port is selected automatically. The editor is optional at the printed editor URL. Reuse the running preview rather than starting another process. If your environment cannot open a local listener, report that limitation; check still works without a listener or browser.\n\nRun check after editing and fix failures. A successful check compiles current source with Tinykit's installed dependencies; it does not prove browser interactions work. Inspect interactive changes in the preview when browser access is available.\n\n## Data and publishing\n\nRuntime records persist under .tinykit/ and are independent of source. Do not edit that directory, replace existing records with seeds, or change project_id. seeds.json initializes new local collections only. Do not read or copy credentials into app source. backend.js is preserved but is not executed.\n\nThis app is ${options.visibility}. Creating and checking it require no hosting account. Publish only when requested. On first publication, choose an upgraded Tinykit server and sign in with tinykit login --server <origin> --email <email>; let the user enter their password. Then use tinykit publish --server <origin>. Later publications use the saved target. First publication starts with an EMPTY hosted database; local records and samples are not transferred. Subsequent publications preserve live records and uploads and support additive schema changes. Destructive changes require a separate migration.\n`
  );
  await writeFile(join(directory, 'TINYKIT.md'), formatGuide);
  await writeFile(
    join(directory, 'README.md'),
    `# ${name}\n\nA local Tinykit app. Read AGENTS.md and TINYKIT.md to customize it with your coding agent.\n\nRun tinykit dev to open the editor, which shows the live app alongside editing and publishing controls (tinykit dev --app-only opens just the app). Run tinykit check --json to build-check it. Keep the dev process running while you use the app. Restarting it retains local records.\n\nPublication is optional and requires your own upgraded Tinykit server. The app is ${options.visibility}. First publication creates an empty hosted database; local records stay local. Later publications preserve hosted records and uploads.\n`
  );
  const fromCwd = relative(process.cwd(), directory);
  const displayPath = fromCwd && !fromCwd.startsWith('..') && !isAbsolute(fromCwd) ? fromCwd : directory;
  return {
    ok: true,
    directory,
    project_id: project.id,
    name,
    template: options.template,
    visibility: options.visibility,
    runtime: 'companion',
    local_only: true,
    hosting_required: false,
    commands: {
      dev: `${cli} dev ${quote(directory)} --no-open`,
      check: `${cli} check ${quote(directory)} --json`
    },
    message: `Created ${name} in ${displayPath}\n\nNext:\n  cd ${shellPath(displayPath)}\n  tinykit dev\n\nEverything runs locally; no account needed.`
  };
}
