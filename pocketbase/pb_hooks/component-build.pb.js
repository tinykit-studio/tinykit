// Revision comparison and source/artifact replacement share the same database
// transaction, including publications from separate Node workers or CLI clients.
routerAdd('GET', '/api/tinykit/projects/{id}/studio-build', (e) => {
  const definitions = require(__hooks + '/lib/definitions.cjs');
  const record = e.app.findRecordById('_tk_projects', e.request.pathValue('id'));
  const info = e.requestInfo();
  if (!e.app.canAccessRecord(record, info, record.collection().viewRule) || !e.app.canAccessRecord(record, info, record.collection().updateRule)) throw new ForbiddenError('Project publication denied.');
  if (record.getString('source_bundle') && record.getString('source_bundle') !== 'null') throw new ApiError(409, 'Publish this component app from its local source folder.');
  const state = definitions.studioBuildState(record);
  e.response.header().set('Cache-Control', 'no-store');
  return e.json(200, { inputs: state.inputs, revision: $security.sha256(definitions.canonical(state)) });
}, $apis.requireAuth('users'));

routerAdd('POST', '/api/tinykit/projects/{id}/component-build', (e) => {
  const source = require(__hooks + '/lib/source.cjs');
  const definitions = require(__hooks + '/lib/definitions.cjs');
  const body = e.requestInfo().body;
  const hasSource = Object.prototype.hasOwnProperty.call(body, 'frontend_code');
  const revision = hasSource ? body.expected_source_hash : body.expected_studio_revision;
  if (typeof body.html !== 'string' || !body.html || body.html.length > 10 * 1024 * 1024 ||
      (hasSource && (typeof body.frontend_code !== 'string' || body.frontend_code.length > 10000000)) ||
      !/^[a-f0-9]{64}$/.test(revision || '')) throw new BadRequestError('Valid HTML and its build revision are required.');
  let bundle;
  if (body.source_bundle !== undefined) {
    try {
      bundle = source.validateSourceBundle(body.source_bundle);
      const app = definitions.base64Bytes(bundle.files['src/App.svelte']);
      // PocketBase 0.23 does not expose TextDecoder or toBytes in its JS VM.
      const frontend = decodeURIComponent(app.map(byte => '%' + byte.toString(16).padStart(2, '0')).join(''));
      if (frontend !== body.frontend_code) throw new Error('App.svelte must match frontend_code.');
    } catch (error) { throw new BadRequestError(error.message); }
  }
  let result;
  e.app.runInTransaction((app) => {
    const record = app.findRecordById('_tk_projects', e.request.pathValue('id'));
    const info = e.requestInfo();
    if (!app.canAccessRecord(record, info, record.collection().viewRule) || !app.canAccessRecord(record, info, record.collection().updateRule)) throw new ForbiddenError('Project publication denied.');
    const currentBundle = JSON.parse(record.getString('source_bundle') || 'null');
    if (currentBundle && !bundle) throw new ApiError(409, 'Include the component app source bundle when publishing.');
    if (bundle && !record.collection().fields.getByName('source_bundle')) throw new ApiError(409, 'Apply the source-bundle database migration before publishing.');
    const currentRevision = hasSource
      ? $security.sha256(source.sourceText(record.getString('frontend_code'), currentBundle))
      : $security.sha256(definitions.canonical(definitions.studioBuildState(record)));
    if (currentRevision !== revision) throw new ApiError(409, hasSource
      ? 'Server source changed; reconcile before publishing.'
      : 'The app changed while Studio was building it. Build again before publishing.');
    if (hasSource) record.set('frontend_code', body.frontend_code);
    if (bundle) record.set('source_bundle', bundle);
    record.set('published_html', $filesystem.fileFromBytes(body.html, 'index.html'));
    app.save(record);
    result = { success: true, ...(hasSource ? { source_hash: $security.sha256(source.sourceText(body.frontend_code, bundle)) } : {}), size: body.html.length };
  });
  return e.json(200, result);
}, $apis.requireAuth('users'), $apis.bodyLimit(10000000));
