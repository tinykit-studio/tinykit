// Only Tinykit's server can submit a mutation and attest to its actor.
routerAdd('POST', '/api/tinykit/projects/{id}/app-data-write', (e) => {
  const body = e.requestInfo().body;
  const payload = typeof body.payload === 'string' ? JSON.parse(body.payload) : body;
  if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    throw new BadRequestError('App data is required.');
  }
  const fields = {};
  e.app.runInTransaction((app) => {
    const record = app.findRecordById('_tk_projects', e.request.pathValue('id'));
    // Read access and save within the same database transaction. A SvelteKit
    // request may have been admitted while the app was still public.
    if (record.getString('visibility') === 'private') {
      if (!payload.actor) throw new UnauthorizedError('Sign in to update this private app.');
      if (record.getString('owner') !== payload.actor) throw new ForbiddenError('Only the app owner can update this app.');
    }
    if (payload.upload) {
      const { collection, index, groups } = payload.upload;
      const target = payload.data[collection]?.records?.[index];
      if (!target || !Array.isArray(groups)) throw new BadRequestError('Invalid upload destination.');
      const files = e.findUploadedFiles('files');
      let offset = 0;
      for (const { field, count } of groups) {
        if (typeof field !== 'string' || field === 'id' || field === '__proto__' ||
            !Number.isInteger(count) || count < 1 || offset + count > files.length) {
          throw new BadRequestError('Invalid upload fields.');
        }
        const filenames = files.slice(offset, offset + count).map(file => file.name);
        fields[field] = target[field] = count === 1 ? filenames[0] : filenames;
        offset += count;
      }
      if (offset !== files.length) throw new BadRequestError('Unexpected uploads.');
      record.set('assets+', files);
    }
    record.set('data', payload.data);
    app.save(record);
  });
  return e.json(200, { fields });
}, $apis.requireSuperuserAuth(), $apis.bodyLimit(30000000));
