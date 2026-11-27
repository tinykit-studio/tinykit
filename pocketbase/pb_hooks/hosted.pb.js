routerAdd('GET', '/api/tinykit/projects/{id}/status', (e) => {
  const d = require(__hooks + '/lib/definitions.cjs');
  const record = e.app.findRecordById('_tk_projects', e.request.pathValue('id'));
  if (!e.app.canAccessRecord(record, e.requestInfo(), record.collection().viewRule)) throw new ForbiddenError('Project access denied.');
  const project = d.fromRecord(record);
  return e.json(200, { protocol: 1, visibility: record.getString('visibility') || 'public', project_id: record.id, base_revision: $security.sha256(d.canonical(d.sourceState(project))), definition: d.definition(project), draft: project.cli_draft, publication: project.cli_publication, public_path: '/tinykit/preview/' + record.id });
}, $apis.requireAuth('users'));

routerAdd('POST', '/api/tinykit/projects/{id}/draft', (e) => {
  const d = require(__hooks + '/lib/definitions.cjs');
  const body = e.requestInfo().body;
  let definition;
  try { definition = d.validate(body.definition); } catch (err) { throw new BadRequestError(err.message); }
  if (!/^[a-f0-9]{64}$/.test(body.expected_base_revision || '') || !Object.prototype.hasOwnProperty.call(body, 'expected_draft_revision') || !/^[a-zA-Z0-9-]{16,80}$/.test(body.request_id || '')) throw new BadRequestError('Expected source revision, draft revision, and request ID are required.');
  const requestFingerprint = $security.sha256(d.canonical({ definition, asset_files: body.asset_files || [] }));
  let result;
  e.app.runInTransaction((app) => {
    const record = app.findRecordById('_tk_projects', e.request.pathValue('id'));
    if (!app.canAccessRecord(record, e.requestInfo(), record.collection().updateRule)) throw new ForbiddenError('Project update denied.');
    const project = d.fromRecord(record), previous = project.cli_draft;
    if (project.source_bundle) throw new ApiError(409, 'Publish this component app from its Svelte project folder using npm run publish.');
    const baseRevision = $security.sha256(d.canonical(d.sourceState(project)));
    if (previous && previous.request_id === body.request_id) {
      if (previous.request_fingerprint !== requestFingerprint) throw new ApiError(409, 'Request ID was already used for a different draft.');
      result = previous; return;
    }
    if (baseRevision !== body.expected_base_revision || ((previous || {}).revision || null) !== body.expected_draft_revision) throw new ApiError(409, 'Hosted source or draft changed. Review it and link again before pushing.');
    try { d.additiveSchema(d.definition(project).schema, definition.schema); } catch (err) { throw new ApiError(409, err.message); }
    // Assets are immutable, separate from project.assets (which includes live uploads).
    const manifest = Object.assign({}, d.definition(project).assets, (previous && previous.definition.assets) || {});
    const incoming = body.asset_files || [];
    if (!Array.isArray(incoming)) throw new BadRequestError('asset_files must be an array.');
    let size = 0;
    for (const asset of incoming) {
      let bytes;
      try { d.assetName(asset.name); bytes = d.base64Bytes(asset.base64); } catch (err) { throw new BadRequestError(err.message); }
      size += bytes.length;
      if (size > 6000000) throw new ApiError(413, 'Source assets exceed the 6 MB push limit.');
      const digest = $security.sha256(asset.base64);
      let stored;
      try { stored = app.findFirstRecordByFilter('_tk_source_assets', 'project = {:project} && digest = {:digest} && filename = {:name}', { project: record.id, digest, name: asset.name }); }
      catch { stored = new Record(app.findCollectionByNameOrId('_tk_source_assets')); stored.set('project', record.id); stored.set('digest', digest); stored.set('filename', asset.name); stored.set('file', $filesystem.fileFromBytes(bytes, asset.name)); app.save(stored); }
      manifest[asset.name] = { digest, id: stored.id, file: stored.getString('file') };
    }
    definition.assets = manifest;
    result = { revision: $security.sha256(d.canonical(definition)), base_revision: baseRevision, request_id: body.request_id, request_fingerprint: requestFingerprint, definition, saved_at: new Date().toISOString() };
    record.set('cli_draft', result);
    // Deliberately never set data, assets, settings, or published_html here.
    app.save(record);
  });
  return e.json(200, { ok: true, draft: result });
}, $apis.requireAuth('users'), $apis.bodyLimit(10000000));

routerAdd('POST', '/api/tinykit/projects/{id}/publish', (e) => {
  const d = require(__hooks + '/lib/definitions.cjs');
  const body = e.requestInfo().body;
  if (typeof body.html !== 'string' || !body.html.startsWith('<!DOCTYPE html>') || body.html.length > 8000000 || !/^[a-zA-Z0-9-]{16,80}$/.test(body.attempt_id || '')) throw new BadRequestError('A complete HTML build and attempt ID are required.');
  let result;
  e.app.runInTransaction((app) => {
    const record = app.findRecordById('_tk_projects', e.request.pathValue('id'));
    if (!app.canAccessRecord(record, e.requestInfo(), record.collection().updateRule)) throw new ForbiddenError('Project publication denied.');
    const project = d.fromRecord(record), draft = project.cli_draft;
    if (project.source_bundle) throw new ApiError(409, 'Publish this component app from its Svelte project folder using npm run publish.');
    if (project.cli_publication && project.cli_publication.attempt_id === body.attempt_id) {
      if (project.cli_publication.revision !== body.draft_revision || project.cli_publication.html_digest !== $security.sha256(body.html)) throw new ApiError(409, 'Attempt ID was already used for a different publication.');
      result = project.cli_publication; return;
    }
    if (!draft || draft.revision !== body.draft_revision || draft.base_revision !== $security.sha256(d.canonical(d.sourceState(project)))) throw new ApiError(409, 'Hosted source or draft changed while building. Push the reviewed source again.');
    if (!body.html.includes('name="tinykit-definition" content="' + draft.revision + '"')) throw new BadRequestError('Build does not identify the selected draft.');
    try { d.additiveSchema(d.definition(project).schema, draft.definition.schema); } catch (err) { throw new ApiError(409, err.message); }
    for (const name of Object.keys(draft.definition.assets)) {
      const asset = draft.definition.assets[name];
      const stored = app.findRecordById('_tk_source_assets', asset.id);
      if (stored.getString('project') !== record.id || stored.getString('digest') !== asset.digest || stored.getString('filename') !== name) throw new BadRequestError('Invalid source asset ownership.');
      if (!stored.getBool('published')) { stored.set('published', true); app.save(stored); }
    }
    ['name','frontend_code','backend_code','custom_instructions','content','design'].forEach((key) => record.set(key, draft.definition[key]));
    record.set('cli_schema', draft.definition.schema);
    record.set('published_html', $filesystem.fileFromBytes(body.html, 'index.html'));
    result = { revision: draft.revision, attempt_id: body.attempt_id, definition: draft.definition, published_at: new Date().toISOString(), html_digest: $security.sha256(body.html) };
    record.set('cli_publication', result);
    result.base_revision = $security.sha256(d.canonical(d.sourceState(d.fromRecord(record))));
    record.set('cli_publication', result);
    // Records and private uploads remain untouched by activation.
    app.save(record);
  });
  return e.json(200, { ok: true, publication: result });
}, $apis.requireAuth('users'), $apis.bodyLimit(10000000));
