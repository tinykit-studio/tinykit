// @ts-nocheck
// Shared, dependency-free definitions contract for Node and PocketBase's JS VM.
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function(k) { return JSON.stringify(k) + ':' + canonical(value[k]); }).join(',') + '}';
  return JSON.stringify(value);
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function schemas(data) {
  var result = {};
  Object.keys(data || {}).forEach(function(name) { result[name] = Array.isArray(data[name]) ? [] : (data[name] || {}).schema || []; });
  return result;
}
function definition(project) {
  var publication = project.cli_publication || {};
  var active = project.cli_schema || {}, legacy = schemas(project.data), schema = {};
  Object.keys(Object.assign({}, active, legacy)).forEach(function(name) {
    var fields = (active[name] || []).slice();
    (legacy[name] || []).forEach(function(field) { var i = fields.findIndex(function(f) { return f.name === field.name; }); if (i < 0) fields.push(field); else fields[i] = field; });
    schema[name] = fields;
  });
  return { name: project.name || '', frontend_code: project.frontend_code || '', backend_code: project.backend_code || '', custom_instructions: project.custom_instructions || '', content: project.content || [], design: project.design || [], schema: schema, assets: (publication.definition || {}).assets || {} };
}
function sourceState(project) {
  var state = { definition: definition(project) };
  if (project.source_bundle) state.source_bundle = project.source_bundle;
  return state;
}
function validate(value) {
  if (!object(value) || Object.keys(value).some(function(k) { return ['name','frontend_code','backend_code','custom_instructions','content','design','schema','assets'].indexOf(k) < 0; })) throw new Error('Only app definitions may be pushed. Records, seeds, settings, and uploads are not accepted.');
  ['name','frontend_code','backend_code','custom_instructions'].forEach(function(k) { if (typeof value[k] !== 'string') throw new Error('Invalid definition field: ' + k); });
  if (!value.name.trim() || value.frontend_code.length > 5000000) throw new Error('App needs a name and source smaller than 5 MB.');
  ['content','design'].forEach(function(k) {
    if (!Array.isArray(value[k]) || value[k].some(function(f) { return !object(f) || typeof f.name !== 'string' || typeof f.type !== 'string'; })) throw new Error('Invalid ' + k + ' definitions.');
  });
  if (!object(value.schema) || !object(value.assets)) throw new Error('Schema and assets must be objects.');
  Object.keys(value.schema).forEach(function(name) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) || ['__proto__','constructor','prototype'].indexOf(name) >= 0 || !Array.isArray(value.schema[name])) throw new Error('Invalid collection name: ' + name);
    var seen = {};
    value.schema[name].forEach(function(f) {
      if (!object(f) || typeof f.name !== 'string' || typeof f.type !== 'string' || seen[f.name]) throw new Error('Invalid or duplicate field in ' + name);
      seen[f.name] = true;
    });
  });
  return value;
}
function additiveSchema(current, next) {
  Object.keys(current).forEach(function(name) {
    if (!Object.prototype.hasOwnProperty.call(next, name)) throw new Error('Removing collection ' + name + ' requires an explicit data migration.');
    current[name].forEach(function(field) {
      var replacement = next[name].find(function(f) { return f.name === field.name; });
      if (!replacement || replacement.type !== field.type || canonical(replacement) !== canonical(field)) throw new Error('Changing or removing ' + name + '.' + field.name + ' requires an explicit data migration. Additive fields and collections are supported.');
    });
  });
}
function assetName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(name) || name === '..') throw new Error('Asset filenames must use letters, numbers, dots, underscores, or hyphens.');
  return name;
}
function fromRecord(record) {
  var p = {};
  ['name','frontend_code','backend_code','custom_instructions'].forEach(function(k) { p[k] = record.getString(k); });
  ['content','design','data','cli_schema','cli_draft','cli_publication','source_bundle'].forEach(function(k) { p[k] = JSON.parse(record.getString(k) || 'null'); });
  return p;
}
function base64Bytes(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid asset encoding.');
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', bytes = [], bits = 0, buffer = 0;
  for (var i = 0; i < value.length && value[i] !== '='; i++) { buffer = (buffer << 6) | alphabet.indexOf(value[i]); bits += 6; if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); } }
  return bytes;
}
module.exports = { canonical: canonical, definition: definition, sourceState: sourceState, validate: validate, additiveSchema: additiveSchema, assetName: assetName, fromRecord: fromRecord, base64Bytes: base64Bytes };
