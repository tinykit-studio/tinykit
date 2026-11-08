migrate((app) => {
  const projects = app.findCollectionByNameOrId('_tk_projects');
  projects.fields.push(new TextField({ name: 'legacy_storage_html', max: 255 }));
  app.save(projects);
  // Mark the exact existing file, including private apps that may later be made
  // public. Do not rewrite the artifact, its source, or the app's records.
  app.db().newQuery("UPDATE _tk_projects SET legacy_storage_html = published_html WHERE published_html <> ''").execute();
}, (app) => {
  const projects = app.findCollectionByNameOrId('_tk_projects');
  projects.fields.removeByName('legacy_storage_html');
  app.save(projects);
});
