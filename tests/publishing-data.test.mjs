import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {parse} from 'acorn';

function loadTS(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  return evaluateTS(source, imports, globals);
}
function evaluateTS(source, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {exports, Request, Response, URL, console, ...globals, require(name) {
    assert.ok(name in imports, `Unexpected import ${name}`); return imports[name];
  }});
  return exports;
}
const mutations = loadTS('src/lib/server/data-mutations.ts');
const dataUtils = loadTS('src/lib/server/data-utils.ts');
const pbSource = ts.createSourceFile('pb.ts', readFileSync(new URL('../src/lib/server/pb.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const lockSource = pbSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'withProjectLock').getText(pbSource);
const {withProjectLock} = evaluateTS(lockSource, {}, {projectLocks:new Map()});
const pause = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  let project = {id:'project',domain:'example.test',data:{
    options:{schema:[{name:'votes',type:'number'}],records:[{id:'a',votes:0},{id:'b',votes:0}]},
    signups:{schema:[{name:'email',type:'text'}],records:[]}
  }};
  let fails = false, writes = 0;
  const imports = {
    '@sveltejs/kit':{json:(body, options) => Response.json(body, options),error:(status,message) => Object.assign(new Error(message),{status})},
    '$lib/server/pb':{
      withProjectLock,
      getProject:async () => {await pause();return structuredClone(project);},
      pb:{collection:() => ({update:async (_id,fields) => {await pause();if(fails)throw new Error('Offline');writes++;project={...project,...structuredClone(fields)};}})}
    },
    '$lib/server/data-security':{check_origin:() => {},check_rate_limit:() => {},get_client_ip:() => '127.0.0.1'},
    '$lib/server/private-apps':{appProjectForRequest:() => structuredClone(project)},
    '$lib/server/data-utils':dataUtils,
    '$lib/server/data-mutations':mutations
  };
  const create = loadTS('src/routes/_tk/data/[project_id]/[collection]/+server.ts', imports).POST;
  const adjust = loadTS('src/routes/_tk/data/[project_id]/[collection]/_adjust/+server.ts', imports).POST;
  const single = loadTS('src/routes/_tk/data/[project_id]/[collection]/[id]/+server.ts', imports);
  const event = (collection, body, query = '', id) => ({params:{project_id:'project',collection,id},request:new Request(`https://example.test/_tk/data/project/${collection}${query}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  return {create,adjust,single,event,get project(){return project;},get writes(){return writes;},set fails(value){fails=value;}};
}

test('concurrent voters and signups preserve every write under the shared project lock', async () => {
  const app = fixture();
  await Promise.all([
    ...Array.from({length:30},()=>app.adjust(app.event('options',[{id:'a',field:'votes',delta:1}]))),
    ...Array.from({length:12},(_,i)=>app.create(app.event('signups',{id:`s${i}`,email:`person${i}@example.test`},'?unique=email')))
  ]);
  assert.equal(app.project.data.options.records[0].votes,30);
  assert.equal(app.project.data.signups.records.length,12);
});

test('concurrent mixed-case duplicate signups create once and return 409', async () => {
  const app = fixture();
  const results = await Promise.allSettled([' Person@Example.test ','person@example.test'].map((email,i)=>app.create(app.event('signups',{id:`s${i}`,email},'?unique=email'))));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.find(result=>result.status==='rejected').reason.status,409);
  assert.equal(app.project.data.signups.records.length,1);
});

test('changing a vote moves one count atomically and rejects incomplete batches', async () => {
  const app = fixture();
  await app.adjust(app.event('options',[{id:'a',field:'votes',delta:1}]));
  await app.adjust(app.event('options',[{id:'a',field:'votes',delta:-1},{id:'b',field:'votes',delta:1}]));
  assert.deepEqual(app.project.data.options.records.map(row=>row.votes),[0,1]);
  await assert.rejects(app.adjust(app.event('options',[{id:'b',field:'votes',delta:-1},{id:'missing',field:'votes',delta:1}])),error=>error.status===404);
  assert.deepEqual(app.project.data.options.records.map(row=>row.votes),[0,1]);
});

test('failed saves release the project queue and do not partially commit counters', async () => {
  const app = fixture(); app.fails = true;
  await assert.rejects(app.adjust(app.event('options',[{id:'a',field:'votes',delta:1}])),error=>error.status===500);
  assert.equal(app.project.data.options.records[0].votes,0);
  app.fails = false;
  await app.adjust(app.event('options',[{id:'a',field:'votes',delta:1}]));
  assert.equal(app.project.data.options.records[0].votes,1);
});

test('counter batches validate numeric schema fields, integers, and safe bounds without mutation', () => {
  const original = {schema:[{name:'votes',type:'number'}],records:[{id:'a',votes:2}]};
  for(const changes of [[],[{id:'a',field:'unknown',delta:1}],[{id:'a',field:'votes',delta:0.1}],[{id:'a',field:'votes',delta:Infinity}]]) {
    assert.throws(()=>mutations.adjust_counters(original,changes),error=>error.status===400);
  }
  assert.equal(original.records[0].votes,2);
  assert.equal(mutations.adjust_counters(original,[{id:'a',field:'votes',delta:-5}]).records[0].votes,0);
});

test('ordinary create, update and delete requests share the counter write ordering', async () => {
  const app = fixture();
  await app.create(app.event('signups',{id:'edit',email:'old@example.test'}));
  await app.create(app.event('signups',{id:'delete',email:'delete@example.test'}));
  await Promise.all([
    app.adjust(app.event('options',[{id:'a',field:'votes',delta:1}])),
    app.single.PATCH(app.event('signups',{email:'new@example.test'},'', 'edit')),
    app.single.DELETE(app.event('signups',{},'', 'delete'))
  ]);
  assert.equal(app.project.data.options.records[0].votes,1);
  assert.deepEqual(app.project.data.signups.records,[{id:'edit',email:'new@example.test'}]);
});

const iframeSource=readFileSync(new URL('../src/lib/compiler/iframe.js',import.meta.url),'utf8');
const declaration=parse(iframeSource,{ecmaVersion:'latest',sourceType:'module'}).body.find(node=>node.type==='VariableDeclaration' && node.declarations[0].id.name==='generate_data_module');
const preview=vm.runInNewContext(iframeSource.slice(declaration.start,declaration.end)+'; generate_data_module');
const production=loadTS('src/routes/tinykit/lib/module-generators.ts').generate_data_module;
for(const [name,generate] of [['preview',preview],['production',production]]) {
  test(`${name}: unique creates send encoded fields and preserve duplicate error status`,async()=>{
    const window={};window.parent=window;
    let requested;
    const db=vm.runInNewContext(generate('project',['signups']).replace('export default db','db'),{
      window,URLSearchParams,console,crypto:{randomUUID:()=> 'newid'},EventSource:class{addEventListener(){}},
      fetch:async url=>{requested=url;return{ok:false,status:409,text:async()=>JSON.stringify({message:'Email already exists'})};}
    });
    await assert.rejects(db.signups.create({email:'person@example.test'},{unique:['email']}),error=>error.status===409 && error.message==='Email already exists');
    assert.equal(new URL(requested,'https://example.test').searchParams.get('unique'),'email');
  });
  test(`${name}: counter adjustments publish confirmed rows and preserve the cache on failure`,async()=>{
    const window={};window.parent=window;let fails=false,latest;
    const db=vm.runInNewContext(generate('project',['options']).replace('export default db','db'),{
      window,URLSearchParams,console,setTimeout,EventSource:class{addEventListener(){}},
      fetch:async url=>url.endsWith('/_adjust') ? fails ? {ok:false,status:503,text:async()=> 'Offline'} : {ok:true,json:async()=>[{id:'a',votes:1}]} : {ok:true,json:async()=>({items:[{id:'a',votes:0},{id:'b',votes:2}]})}
    });
    db.options.subscribe(rows=>latest=rows);await db.options.list();
    await db.options.adjust([{id:'a',field:'votes',delta:1}]);
    assert.deepEqual(Array.from(latest,row=>row.votes),[1,2]);
    // Another voter can update immediately after this response; confirmed
    // counter writes must not suppress that live update during a cooldown.
    window.__tk_update_data({options:{records:[{id:'a',votes:3},{id:'b',votes:2}]}});
    assert.deepEqual(Array.from(latest,row=>row.votes),[3,2]);
    fails=true;await assert.rejects(db.options.adjust([{id:'a',field:'votes',delta:1}]),error=>error.status===503);
    assert.deepEqual(Array.from(latest,row=>row.votes),[3,2]);
  });
}

test('gallery counter changes and duplicate checks stay isolated in memory',async()=>{
  const {generate_memory_data_module}=await import('../src/lib/compiler/memory-data.js');
  const window={};
  const db=vm.runInNewContext(generate_memory_data_module(['options','signups']).replace('export default collections;','collections'),{window,queueMicrotask,crypto:{randomUUID:()=> 'created'}});
  window.__tk_update_data({options:{schema:[{name:'votes',type:'number'}],records:[{id:'a',votes:1},{id:'b',votes:0}]},signups:{records:[{id:'existing',email:'PERSON@example.test'}]}});
  await db.options.adjust([{id:'a',field:'votes',delta:-1},{id:'b',field:'votes',delta:1}]);
  assert.deepEqual(Array.from(await db.options.list(),row=>row.votes),[0,1]);
  await assert.rejects(db.options.adjust([{id:'b',field:'votes',delta:-1},{id:'missing',field:'votes',delta:1}]));
  assert.deepEqual(Array.from(await db.options.list(),row=>row.votes),[0,1]);
  await assert.rejects(db.signups.create({email:' person@example.test '},{unique:['email']}),error=>error.status===409);
});
