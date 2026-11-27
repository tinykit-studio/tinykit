// A locally created app gets a hosted identity only when the user publishes.
// Creation metadata is separate from source, so source edits cannot turn a
// retry into permission to acknowledge or overwrite a newer hosted revision.
routerAdd('POST', '/api/tinykit/projects/{id}/create', (e) => {
  const d = require(__hooks + '/lib/definitions.cjs');
  const id = e.request.pathValue('id');
  const body = e.requestInfo().body;
  if (!/^[a-z0-9]{15}$/.test(id) || !body || Object.keys(body).some((key) => ['creation_id', 'name', 'visibility'].indexOf(key) < 0)) throw new BadRequestError('A project ID and creation intent are required.');
  if (typeof body.creation_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.creation_id)) throw new BadRequestError('A valid creation ID is required.');
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100 || /[\x00-\x1f]/.test(body.name)) throw new BadRequestError('Give the app a name, up to 100 characters.');
  if (['private', 'public'].indexOf(body.visibility) < 0) throw new BadRequestError('Choose private or public app access.');
  const name = body.name.trim();
  const fingerprint = $security.sha256(d.canonical({ project_id: id, creation_id: body.creation_id, name, visibility: body.visibility }));
  let result;
  e.app.runInTransaction((app) => {
    const collection = app.findCollectionByNameOrId('_tk_projects');
    // The privacy and creation migrations must both be present. Never silently
    // create a public or ownerless app on an older server.
    for (const field of ['owner', 'visibility', 'cli_creation']) {
      if (!collection.fields.getByName(field)) throw new ApiError(409, 'Upgrade Tinykit with local-app creation and private-app access before publishing.');
    }
    let record = app.findRecordsByFilter(collection, 'id = {:id}', '', 1, 0, { id })[0];
    if (record) {
      const creation = JSON.parse(record.getString('cli_creation') || 'null');
      if (record.getString('owner') !== e.auth.id || !creation || creation.creation_id !== body.creation_id || creation.request_fingerprint !== fingerprint) throw new ApiError(409, 'This project ID already belongs to another creation. Review the existing app before linking it.');
      if (!app.canAccessRecord(record, e.requestInfo(), collection.viewRule)) throw new ForbiddenError('Project access denied.');
      if (record.getString('visibility') !== body.visibility) throw new ApiError(409, 'Hosted app access changed. Review the existing app before linking it.');
      if (!/^[a-f0-9]{64}$/.test(creation.base_revision || '')) throw new ApiError(409, 'The original creation baseline is unavailable. Review the existing app before linking it.');
      result = { protocol: 1, project_id: id, creation_id: body.creation_id, visibility: body.visibility, base_revision: creation.base_revision, draft_revision: null, recovered: true };
      return;
    }
    if (collection.createRule === null) throw new ForbiddenError('Your account cannot create apps on this server.');
    record = new Record(collection);
    record.id = id;
    record.set('name', name);
    record.set('owner', e.auth.id);
    record.set('visibility', body.visibility);
    record.set('kit', 'custom');
    record.set('domain', '');
    for (const field of ['frontend_code', 'backend_code', 'custom_instructions']) record.set(field, '');
    for (const field of ['content', 'design', 'snapshots', 'agent_chat']) record.set(field, []);
    record.set('data', {});
    record.set('settings', {});
    const base = $security.sha256(d.canonical(d.sourceState(d.fromRecord(record))));
    record.set('cli_creation', { creation_id: body.creation_id, request_fingerprint: fingerprint, base_revision: base });
    // canAccessRecord evaluates field-based rules by querying the database.
    // The saved record is visible in this transaction only. A denied create
    // rule throws and rolls the entire insertion back before it can escape.
    app.save(record);
    if (!app.canAccessRecord(record, e.requestInfo(), collection.createRule)) throw new ForbiddenError('Your account cannot create this app on the server.');
    result = { protocol: 1, project_id: id, creation_id: body.creation_id, visibility: body.visibility, base_revision: base, draft_revision: null, recovered: false };
  });
  return e.json(result.recovered ? 200 : 201, result);
}, $apis.requireAuth('users'), $apis.bodyLimit(4096));

// The ordinary record API must not allow a builder to prepare a forged marker
// on a colliding public app, including an app they can otherwise edit.
onRecordCreateRequest((e) => {
  const value = JSON.parse(e.record.getString('cli_creation') || 'null');
  if (!e.auth?.isSuperuser() && value !== null) throw new ForbiddenError('App creation metadata is managed by Tinykit.');
  e.next();
}, '_tk_projects');

onRecordUpdateRequest((e) => {
  if (!e.auth?.isSuperuser()) {
    const d = require(__hooks + '/lib/definitions.cjs');
    const before = JSON.parse(e.record.original().getString('cli_creation') || 'null');
    const after = JSON.parse(e.record.getString('cli_creation') || 'null');
    if (d.canonical(before) !== d.canonical(after)) throw new ForbiddenError('App creation metadata cannot be changed.');
  }
  e.next();
}, '_tk_projects');
