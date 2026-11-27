import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,symlink,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compile} from 'svelte/compiler';
import {launcherStore,createStarter,checkedAppDirectory,starterTemplate} from '../scripts/companion/starter.mjs';
import {parseStartArgs,guardLauncher} from '../scripts/companion/launch.mjs';
import {login} from '../scripts/companion/auth.mjs';

const server='https://tinykit.example';
async function fixture(t,{loseCreateResponse=false,failExport=false}={}) {
  const root=await mkdtemp(join(tmpdir(),'tinykit-journey-'));
  const environment=Object.fromEntries(['TINYKIT_CONFIG_DIR','TINYKIT_TOKEN','TINYKIT_TOKEN_FILE'].map(key=>[key,process.env[key]]));
  process.env.TINYKIT_CONFIG_DIR=join(root,'auth');delete process.env.TINYKIT_TOKEN;delete process.env.TINYKIT_TOKEN_FILE;
  const previous=globalThis.fetch,records=new Map();let creates=0;
  const state={failExport};
  globalThis.fetch=async (url,options={})=>{
    url=String(url);
    if(url.endsWith('auth-with-password'))return Response.json({token:'fixture-private-token'});
    assert.equal(options.headers.Authorization,'Bearer fixture-private-token');
    assert.equal(options.redirect,'error');
    if(url.endsWith('/hosted'))return Response.json({message:'Project not found.'},{status:404});
    if(url.endsWith('/records')&&options.method==='POST'){
      creates++;const value=JSON.parse(options.body);records.set(value.id,value);
      if(loseCreateResponse)throw new TypeError('Connection lost after commit');
      return Response.json(value);
    }
    const id=url.match(/(?:records|projects)\/([a-z0-9]{15})/)?.[1];
    const project=records.get(id);
    if(!project)return Response.json({message:'Not found.'},{status:404});
    if(url.includes('/export?')){
      if(state.failExport)return Response.json({message:'Export temporarily unavailable.'},{status:503});
      return Response.json({...project,settings:undefined,hosted:{server,project_id:id,base_revision:'a'.repeat(64),draft_revision:null},export_options:{include_records:false,include_assets:false}});
    }
    return Response.json(project);
  };
  t.after(async()=>{globalThis.fetch=previous;for(const [key,value]of Object.entries(environment))if(value===undefined)delete process.env[key];else process.env[key]=value;await rm(root,{recursive:true,force:true});});
  await login({server,email:'builder@example.com',password:'fixture-password'});
  return {root,store:await launcherStore(join(root,'apps')),records,state,get creates(){return creates;}};
}

test('starter setup creates one connected app, keeps samples local, and never exports credentials',async t=>{
  const f=await fixture(t);
  const {app,directory}=await createStarter(f.store,{server,name:'Studio projects',request_id:'request-studio-projects-1'});
  assert.equal(f.creates,1);assert.equal(f.store.index.apps.length,1);
  const hosted=f.records.get(app.id);
  assert.deepEqual(hosted.data.projects.records,[]);assert.deepEqual(hosted.data.tasks.records,[]);
  assert.equal(hosted.content.find(field=>field.id==='title').value,'Studio projects');
  assert.equal(hosted.settings.template_id,'project-tracker');
  const config=JSON.parse(await readFile(join(directory,'tinykit.json'),'utf8'));
  assert.equal(config.hosted.server,server);assert.equal(config.project_id,app.id);assert.equal(config.hosted.base_revision,'a'.repeat(64));
  const seeds=JSON.parse(await readFile(join(directory,'seeds.json'),'utf8'));assert.equal(seeds.projects.length,3);assert.equal(seeds.tasks.length,3);
  const credentials=join(directory,'.tinykit/credentials.json');assert.equal((await stat(credentials)).mode&0o777,0o600);
  for(const name of ['App.svelte','tinykit.json','content.json','seeds.json','AGENTS.md','README.md'])assert.doesNotMatch(await readFile(join(directory,name),'utf8'),/fixture-private-token|fixture-password/);
  await writeFile(join(directory,'App.svelte'),'<h1>My local customization</h1>');
  const repeated=await createStarter(f.store,{server,name:'Studio projects',request_id:'request-studio-projects-1'});
  assert.equal(repeated.app.id,app.id);assert.equal(f.creates,1);assert.equal(await readFile(join(directory,'App.svelte'),'utf8'),'<h1>My local customization</h1>');
  const reopened=await launcherStore(f.store.root);assert.equal(reopened.index.apps[0].id,app.id);
});

test('a lost hosted-create response resumes the same app without a duplicate',async t=>{
  const f=await fixture(t,{loseCreateResponse:true});
  const result=await createStarter(f.store,{server,name:'Recoverable app',request_id:'request-recoverable-app'});
  assert.equal(f.creates,1);assert.equal(f.records.size,1);assert.equal(result.app.state,'ready');
});

test('failed export can be retried across launcher restarts without another hosted app',async t=>{
  const f=await fixture(t,{failExport:true});
  const input={server,name:'Finish setup',request_id:'request-finish-setup-1'};
  await assert.rejects(createStarter(f.store,input),/temporarily unavailable/);
  const first=f.store.index.apps[0].id;assert.equal(f.store.index.apps[0].state,'needs_attention');
  f.state.failExport=false;
  const reopened=await launcherStore(f.store.root),result=await createStarter(reopened,input);
  assert.equal(result.app.id,first);assert.equal(f.creates,1);assert.equal(result.app.state,'ready');
});

test('saved app paths and identities cannot redirect the launcher into another folder',async t=>{
  const f=await fixture(t),input={server,name:'Safe app',request_id:'request-safe-app-123'};
  const {app,directory}=await createStarter(f.store,input);
  await assert.rejects(checkedAppDirectory(f.store,{...app,folder:'../outside'}),/Invalid/);
  const outside=join(f.root,'outside');await mkdir(outside);await symlink(outside,join(f.store.root,'linked'));
  await assert.rejects(checkedAppDirectory(f.store,{...app,folder:'linked'}),/must stay/);
  const config=JSON.parse(await readFile(join(directory,'tinykit.json'),'utf8'));config.project_id='otherproject123';await writeFile(join(directory,'tinykit.json'),JSON.stringify(config));
  await assert.rejects(checkedAppDirectory(f.store,app),/different app/);
});

test('local launcher rejects cross-origin writes and DNS rebinding while accepting its own UI',()=>{
  const origin='http://127.0.0.1:5188',request={method:'POST',headers:{host:'127.0.0.1:5188',origin}};
  assert.doesNotThrow(()=>guardLauncher(request,origin));
  for(const headers of [{host:'evil.example',origin},{host:'127.0.0.1:5188',origin:'https://evil.example'},{host:'127.0.0.1:5188'},{...request.headers,'sec-fetch-site':'cross-site'}])assert.throws(()=>guardLauncher({...request,headers},origin),/local Tinykit/);
  assert.equal(parseStartArgs(['--server',server,'--no-open']).open,false);
  assert.throws(()=>parseStartArgs(['--server','http://remote.example']),/HTTPS/);
  assert.throws(()=>parseStartArgs(['--port','0']),/port/);
});

test('the tracker compiles for preview and publication with separate example records',async()=>{
  const template=await starterTemplate();
  for(const generate of ['client','server'])assert.equal(compile(template.frontend_code,{filename:'ProjectTracker.svelte',generate}).warnings.length,0);
  assert.equal(template.data.projects.records.length,0);assert.equal(template.data.tasks.records.length,0);
  for(const task of template.preview_records.tasks)assert.ok(template.preview_records.projects.some(project=>project.id===task.project_id));
});
