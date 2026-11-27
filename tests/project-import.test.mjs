import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { validateSourceBundle } from '../scripts/static-project/source-tree.mjs';
const plain = value => JSON.parse(JSON.stringify(value));
function load(path, imports = {}, extra = {}) {
  const filename = new URL('../' + path, import.meta.url);
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const exports = {};
  vm.runInNewContext(source, {exports,require(name){if(name.endsWith('.json'))return JSON.parse(readFileSync(new URL(name,filename),'utf8'));assert.ok(name in imports, 'Unexpected import '+name);return imports[name];},Buffer,Blob,FormData,Request,Response,URL,console,...extra});
  return exports;
}
const {normalizeProjectImport} = load('src/lib/project-import.ts');
const catalog = load('src/lib/templates/index.ts');
const exported = {
  id:'oldapp123456789',name:'My restored app',frontend_code:'<h1>\nExample\n</h1>',backend_code:'// keep backend\n// exact source',custom_instructions:'Keep my app simple.\nKeep these line endings.',
  content:[{id:'title',name:'Title',type:'text',value:'My title'}],design:[{id:'accent',name:'Accent',type:'color',css_var:'--accent',value:'#203040'}],
  data:{items:{icon:'list',schema:[{name:'id',type:'id'},{name:'amount',type:'number'},{name:'done',type:'boolean'}],records:[{id:'keep-id',amount:0,done:false,nothing:null,tags:[],text:'',created:'2020-01-02T03:04:05Z'}]}},
  settings:{secret:'never-restore'},agent_chat:['never-restore'],domain:'original.example',hosted:{server:'https://original.example'},assets:[]
};
function route({authenticated=true,denied=false,failUpdate=false}={}) {
  const writes=[],deletions=[];
  const collection = {
    async create(form){assert.ok(authenticated);if(denied)throw {status:403};const fields={};let assets=[];if(typeof form.entries==='function'){form=await new Request('http://fixture/upload',{method:'POST',body:form}).formData();for(const [key,value] of form.entries())if(typeof value==='string'){try{fields[key]=JSON.parse(value);}catch{fields[key]=value;}}assets=form.getAll('assets').map(file=>file.name.replace(/(\.[^.]+)$/,'_stored$1'));}else Object.assign(fields,plain(form));const value={...fields,owner:'builder',id:'newapp123456789',assets};writes.push(value);return value;},
    async update(id,fields){if(failUpdate)throw new Error('Upload restoration failed');const value={...writes[0],...fields,id};writes.push(value);return value;},
    async delete(id){deletions.push(id);}
  };
  const {POST}=load('src/routes/api/projects/import/+server.ts',{
    '@sveltejs/kit':{json:(value,init)=>Response.json(value,init)},
    '$lib/server/pb':{pb:{baseURL:'http://fixture'},validateUserToken:async()=>authenticated?{id:'builder'}:null,unauthorizedResponse:message=>Response.json({error:message},{status:401})},
    '$lib/project-import':{normalizeProjectImport},
    '../../../../../scripts/static-project/source-tree.mjs':{validateSourceBundle},
    pocketbase:class{authStore={save(){}};autoCancellation(){};collection(){return collection;}}
  });
  return {writes,deletions,post:async(app=exported)=>POST({request:new Request('http://fixture/api/projects/import',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({app,filename:'unrelated-file-name.json',kit:'chosen-kit'})})})};
}

test('app import preserves record IDs, timestamps, zero, false, null, empty strings, schemas, and design',()=>{
 const result=plain(normalizeProjectImport(exported,'wrong-name.json'));
 assert.equal(result.name,exported.name);for(const key of ['frontend_code','backend_code','custom_instructions','data','design','content'])assert.deepEqual(result[key],exported[key]);
 for(const key of ['id','settings','agent_chat','domain','hosted'])assert.equal(result[key],undefined);
});
test('legacy History snapshots retain descriptions, collections, and collection metadata',()=>{
 const result=plain(normalizeProjectImport({description:'Before editing',frontend_code:'',design:[],content:[],collections:[{name:'items',...exported.data.items}]},'snapshot-2026-10-21-old.json'));
 assert.equal(result.name,'Before editing');assert.deepEqual(result.data,exported.data);
 assert.equal(normalizeProjectImport({frontend_code:''},'snapshot-2026-10-21-example.json').name,'example');
});
test('an explicit empty data object takes precedence over stale legacy collections',()=>{
 assert.deepEqual(plain(normalizeProjectImport({...exported,data:{},collections:[{name:'old',schema:[],records:[{id:'old'}]}]})).data,{});
});
test('invalid import structures fail before creating an app',async t=>{
 for(const value of [null,[],{}, {frontend_code:5},{frontend_code:'',design:{}},{frontend_code:'',content:[null]},{frontend_code:'',data:[]},{frontend_code:'',data:{items:{schema:{},records:[]}}},{frontend_code:'',data:{items:{records:[null]}}},{frontend_code:'',collections:[{name:'items'},{name:'items'}]},JSON.parse('{"frontend_code":"","data":{"__proto__":[]}}')])await t.test(JSON.stringify(value),async()=>{const h=route();assert.equal((await h.post(value)).status,400);assert.equal(h.writes.length,0);});
});
test('all catalog apps retain content, design, schemas, and records on export-format import',async t=>{
 for(const template of catalog.TEMPLATES)await t.test(template.name,async()=>{const h=route();const response=await h.post({...template,id:exported.id});assert.equal(response.status,201);const app=await response.json();assert.notEqual(app.id,exported.id);assert.equal(app.name,template.name);assert.equal(app.frontend_code,template.frontend_code);assert.deepEqual(app.content,template.content||[]);assert.deepEqual(app.design,template.design||[]);assert.deepEqual(app.data,template.data||{});assert.equal(app.kit,'chosen-kit');assert.equal(app.domain,'');});
});
test('imports use a new identity and fresh settings rather than reusing service secrets or publication state',async()=>{
 const h=route();const response=await h.post({...exported,published_html:'do not publish',cli_publication:{secret:'private'}});assert.equal(response.status,201);const app=await response.json();assert.equal(app.id,'newapp123456789');assert.equal(app.settings.secret,undefined);assert.equal(app.agent_chat,undefined);assert.equal(app.published_html,undefined);assert.equal(app.cli_publication,undefined);assert.deepEqual(app.data,exported.data);assert.deepEqual(app.design,exported.design);
});
test('import authenticates before any project creation',async()=>{const h=route({authenticated:false});assert.equal((await h.post()).status,401);assert.equal(h.writes.length,0);});
test('import respects caller creation rules',async()=>{const h=route({denied:true});assert.equal((await h.post()).status,403);assert.equal(h.writes.length,0);});
test('uploads are restored with working references without renaming ordinary text records',async()=>{
 const h=route();const app={...exported,frontend_code:'<script>import {asset} from "$tinykit";</script><img src={asset("logo.png")} alt="Logo">',content:[{id:'logo',name:'Logo',type:'image',value:'logo.png'}],data:{items:{schema:[{name:'title',type:'text'},{name:'image',type:'file'},{name:'description',type:'text'}],records:[{id:'keep-id',title:'logo.png',image:'logo.png',description:'<img src="https://original.example/_tk/assets/oldapp123456789/logo.png">'}]}},assets:['logo.png'],asset_files:[{name:'logo.png',base64:Buffer.from('image bytes').toString('base64')}]};
 const response=await h.post(app);assert.equal(response.status,201);const restored=await response.json();assert.equal(restored.content[0].value,'tkimport0_stored.png');assert.equal(restored.data.items.records[0].image,'tkimport0_stored.png');assert.equal(restored.data.items.records[0].title,'logo.png');assert.match(restored.frontend_code,/asset\("tkimport0_stored.png"\)/);assert.match(restored.data.items.records[0].description,/\/_tk\/assets\/newapp123456789\/tkimport0_stored.png/);assert.doesNotMatch(restored.data.items.records[0].description,/original.example|oldapp/);
});
test('bad or incomplete uploaded files are rejected before writing',async t=>{
 for(const extra of [{assets:['missing.png']},{asset_files:[{name:'../bad.png',base64:'eA=='}]},{asset_files:[{name:'bad.png',base64:'!'}]},{asset_files:[{name:'x.png',base64:'eA=='},{name:'x.png',base64:'eA=='}]}])await t.test(JSON.stringify(extra),async()=>{const h=route();assert.equal((await h.post({...exported,...extra})).status,400);assert.equal(h.writes.length,0);});
});
test('failed upload restoration removes the incomplete new app',async()=>{
 const h=route({failUpdate:true});const response=await h.post({...exported,assets:['a.png'],asset_files:[{name:'a.png',base64:'eA=='}]});assert.equal(response.status,500);assert.deepEqual(h.deletions,['newapp123456789']);
});
test('multi-file exports keep their source tree while invalid paths cannot create an app',async()=>{
 const bundle={format_version:1,files:{'src/App.svelte':Buffer.from('old root').toString('base64'),'src/Child.svelte':Buffer.from('<p>Child</p>').toString('base64'),'tinykit/data.js':Buffer.from("const PROJECT_ID = 'oldapp123456789'\nexport default PROJECT_ID").toString('base64'),'package.json':Buffer.from('{}').toString('base64'),'index.html':Buffer.from('<div></div>').toString('base64')}};
 const h=route();const response=await h.post({...exported,source_bundle:bundle});assert.equal(response.status,201);const app=await response.json();assert.equal(app.source_bundle.files['src/Child.svelte'],bundle.files['src/Child.svelte']);assert.equal(Buffer.from(app.source_bundle.files['src/App.svelte'],'base64').toString(),exported.frontend_code);
 assert.match(Buffer.from(app.source_bundle.files['tinykit/data.js'],'base64').toString(),/newapp123456789/);assert.doesNotMatch(Buffer.from(app.source_bundle.files['tinykit/data.js'],'base64').toString(),/oldapp123456789/);
 const invalid=route();assert.equal((await invalid.post({...exported,source_bundle:{...bundle,files:{...bundle.files,'../private.txt':'eA=='}}})).status,400);assert.equal(invalid.writes.length,0);
});

test('History file restore replaces data exactly, including an empty database and cleared source tree',async()=>{
 const writes=[];
 const {restore_from_snapshot_data}=load('src/routes/tinykit/lib/api.svelte.ts',{
  '$lib/pocketbase.svelte':{pb:{collection:()=>({getOne:async()=>({data:{stale:{schema:[],records:[{id:'old'}]}},source_bundle:{format_version:1,files:{}}}),update:async(id,value)=>{writes.push(plain(value));return {id,...value};}})}},
  '$lib/services/project.svelte':{project_service:{}},
  '$lib/compiler/init':{transform_content_fields(){}},
  './module-generators':{generate_data_module(){},generate_tinykit_module(){}}
 });
 const fields={frontend_code:exported.frontend_code,design:exported.design,content:exported.content,backend_code:exported.backend_code,custom_instructions:exported.custom_instructions,source_bundle:null};
 await restore_from_snapshot_data('target',{...fields,data:exported.data});assert.deepEqual(writes[0].data,exported.data);assert.deepEqual(writes[0].design,exported.design);assert.equal(writes[0].source_bundle,null);assert.equal(writes[0].backend_code,exported.backend_code);
 await restore_from_snapshot_data('target',{...fields,data:{}});assert.deepEqual(writes[1].data,{});
});

test('CLI exports without editor IDs receive unique IDs while their field values stay intact',()=>{
 const fields=[{name:'First',type:'text',value:0},{name:'Second',type:'boolean',value:false},{id:'imported-content-0',name:'Existing',type:'text',value:''}];
 const result=normalizeProjectImport({frontend_code:'',content:fields,design:[{name:'Accent',type:'color',css_var:'--accent',value:'#123456'}]});
 assert.equal(new Set(result.content.map(f=>f.id)).size,3);assert.equal(result.content[2].id,'imported-content-0');assert.deepEqual(result.content.map(f=>f.value),[0,false,'']);assert.equal(result.design[0].value,'#123456');assert.ok(result.design[0].id);
 assert.throws(()=>normalizeProjectImport({frontend_code:'',content:[{id:'same',name:'A',type:'text'},{id:'same',name:'B',type:'text'}]}),/Duplicate content field ID/);
});
