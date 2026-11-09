import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { marked } from 'marked';

// Local data for exported apps. Production uses Tinykit's existing data API.
// No request from this middleware goes to the source server.
const mutationError = (status, message) => Object.assign(new Error(message), { status });

// Keep these validation rules aligned with server/data-mutations.ts. This file
// is copied into exported projects and cannot import application server files.
function assertUnique(records, body, fields) {
  if (body.id != null && records.some(record => String(record.id) === String(body.id))) {
    throw mutationError(409, 'A record with this ID already exists.');
  }
  if (!fields.length) return;
  if (fields.length > 8 || fields.some(field => !/^[a-zA-Z_]\w{0,63}$/.test(field))) {
    throw mutationError(400, 'Invalid unique fields.');
  }
  const normalize = value => typeof value === 'string' ? value.trim().toLowerCase() : value;
  if (fields.some(field => body[field] == null || !['string', 'number', 'boolean'].includes(typeof body[field]) || normalize(body[field]) === '')) {
    throw mutationError(400, 'Unique fields need a non-empty value.');
  }
  if (records.some(record => fields.every(field => normalize(record[field]) === normalize(body[field])))) {
    throw mutationError(409, `A record with this ${fields.join(', ')} already exists.`);
  }
}

function adjustCounters(rows, schema, changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 20) {
    throw mutationError(400, 'Provide between 1 and 20 counter changes.');
  }
  const records = rows.map(record => ({ ...record }));
  const updated = new Set();
  for (const change of changes) {
    if (!change || typeof change.id !== 'string' || !change.id || typeof change.field !== 'string' ||
        !schema.some(field => field.name === change.field && field.type === 'number') || change.field === 'id' ||
        !Number.isSafeInteger(change.delta) || Math.abs(change.delta) > 1000000) {
      throw mutationError(400, 'Counter changes require a record ID, numeric schema field, and integer delta.');
    }
    const record = records.find(record => String(record.id) === change.id);
    if (!record) throw mutationError(404, 'Record not found.');
    const current = Number(record[change.field] ?? 0);
    if (!Number.isSafeInteger(current) || !Number.isSafeInteger(current + change.delta)) {
      throw mutationError(400, 'Counter value must be a safe integer.');
    }
    record[change.field] = Math.max(0, current + change.delta);
    updated.add(String(record.id));
  }
  return { records, items: records.filter(record => updated.has(String(record.id))) };
}

export function localBackend(root, config) {
  const clients = new Set();
  let queue = Promise.resolve();
  const read = async name => JSON.parse(await readFile(join(root, name), 'utf8'));
  const storePath = join(root, '.tinykit', 'local-data.json');
  async function data() {
    try { return JSON.parse(await readFile(storePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return read('seeds.json'); }
  }
  async function save(value) {
    await mkdir(join(root, '.tinykit'), { recursive: true });
    const temp = `${storePath}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temp, storePath);
    const message = `event: data_updated\ndata: ${JSON.stringify(value)}\n\n`;
    for (const response of clients) response.write(message);
  }
  return {
    name: 'tinykit-local-fixtures',
    configureServer(server) {
      server.httpServer?.once('close', () => { for (const response of clients) response.end(); });
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (!url.pathname.startsWith('/_tk/')) return next();
        const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
        async function handle() {
          if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, { message: 'Local requests only.' });
          if (url.pathname === `/_tk/config/${config.project_id}` && req.method === 'GET') {
            const content = {};
            for (const field of await read('content.json')) {
              const key = field.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
              content[key] = field.type === 'markdown' && field.value ? marked.parse(field.value) : field.value;
            }
            return send(200, { content, design: Object.fromEntries((await read('design.json')).map(f => [f.css_var, f.value])) });
          }
          if (url.pathname === `/_tk/realtime/${config.project_id}` && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
            res.write('event: connected\ndata: {}\n\n');
            clients.add(res);
            req.on('close', () => clients.delete(res));
            return;
          }
          const prefix = `/_tk/data/${config.project_id}/`;
          if (!url.pathname.startsWith(prefix)) return send(404, { message: 'Unknown local endpoint.' });
          const [collection, id, extra] = url.pathname.slice(prefix.length).split('/');
          const schemas = await read('schema.json');
          if (!Object.hasOwn(schemas, collection) || extra) return send(404, { message: 'Unknown collection.' });
          const adjusting = id === '_adjust';
          const allowedParams = req.method === 'GET' && !id ? ['page', 'perPage'] : req.method === 'POST' && !id ? ['unique'] : [];
          if ([...url.searchParams.keys()].some(key => !allowedParams.includes(key))) return send(400, { message: 'Unsupported local query parameter.' });
          const all = await data(), rows = all[collection] || [];
          const index = rows.findIndex(row => row.id === id);
          if (req.method === 'GET') {
            if (adjusting) return send(405, { message: 'Method not allowed.' });
            if (id) return send(index < 0 ? 404 : 200, index < 0 ? { message: 'Record not found.' } : rows[index]);
            const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
            const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('perPage') || '50', 10)));
            if (!Number.isFinite(page) || !Number.isFinite(perPage)) return send(400, { message: 'Invalid pagination.' });
            const start = (page - 1) * perPage;
            return send(200, { items: rows.slice(start, start + perPage), totalItems: rows.length, page, perPage, totalPages: Math.ceil(rows.length / perPage) });
          }
          if (adjusting ? req.method !== 'POST' : !['POST', 'PATCH', 'DELETE'].includes(req.method) || (req.method === 'POST') === Boolean(id)) return send(405, { message: 'Method not allowed.' });
          if (id && !adjusting && index < 0) return send(404, { message: 'Record not found.' });
          let body = {};
          if (req.method !== 'DELETE') {
            if (!req.headers['content-type']?.includes('application/json')) return send(415, { message: 'Local writes require JSON.' });
            let raw = '';
            for await (const chunk of req) { raw += chunk; if (raw.length > 1024 * 1024) return send(413, { message: 'Too large.' }); }
            try { body = JSON.parse(raw); } catch { return send(400, { message: 'Invalid JSON body.' }); }
            if (!adjusting && (!body || typeof body !== 'object' || Array.isArray(body))) return send(400, { message: 'Expected a record.' });
          }
          if (adjusting) {
            const result = adjustCounters(rows, schemas[collection], body);
            all[collection] = result.records;
            await save(all);
            return send(200, result.items);
          }
          let result;
          if (req.method === 'POST') {
            assertUnique(rows, body, url.searchParams.getAll('unique'));
            result = { ...body, id: body.id || randomUUID() };
            rows.push(result);
          } else if (req.method === 'PATCH') result = rows[index] = { ...rows[index], ...body, id };
          else rows.splice(index, 1);
          all[collection] = rows;
          await save(all);
          return send(req.method === 'POST' ? 201 : 200, result || { success: true });
        }
        // Serialize fixture mutations and reads to prevent lost writes.
        queue = queue.then(handle).catch(error => { if (!res.headersSent) send(error.status || 500, { message: error.message }); else res.end(); });
      });
    }
  };
}
