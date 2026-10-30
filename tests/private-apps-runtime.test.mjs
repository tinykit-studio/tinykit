import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import PocketBase from 'pocketbase';
import unzipper from 'unzipper';
import { createBackup, scheduleBackups } from '../scripts/instance-backup.mjs';
import { exportWorkspace } from '../scripts/companion/workspace.mjs';

const exec = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function ready(fn) { for (let i=0;i<250;i++) { try { if(await fn()) return; } catch {} await delay(100); } throw Error('Private-app fixture did not start.'); }

test('private apps restrict pages, records, files, realtime, builder APIs, and direct PocketBase access to their owner', { skip: !process.env.TINYKIT_TEST_PRIVATE, timeout: 180000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'tinykit-private-'));
  const pbPort = await port(), webPort = await port();
  const server = `http://127.0.0.1:${webPort}`, pbURL = `http://127.0.0.1:${pbPort}`;
  const email = 'owner@fixture.test', password = 'private-fixture-password';
  const binary = join(root, 'pocketbase/pocketbase');
  const flags = ['--automigrate=false', '--dir', join(temporary, 'pb_data'), '--migrationsDir', join(root, 'pocketbase/pb_migrations'), '--hooksDir', join(root, 'pocketbase/pb_hooks')];
  let logs='', children=[];
  const track = child => { children.push(child); child.stdout?.on('data', d => {logs+=d}); child.stderr?.on('data', d => {logs+=d}); return child; };
  t.after(async () => { for(const child of children.reverse()) if(child.exitCode===null && child.signalCode===null) {const done=once(child,'exit');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);child.kill();await done;clearTimeout(timer);} await rm(temporary,{recursive:true,force:true}); });
  try {
    await exec(binary, ['superuser','upsert',email,password,...flags]);
    track(spawn(binary,['serve','--http',`127.0.0.1:${pbPort}`,...flags],{stdio:['ignore','pipe','pipe']}));
    const admin = new PocketBase(pbURL); admin.autoCancellation(false);
    await ready(async()=> (await admin.health.check()).code===200);
    await admin.collection('_superusers').authWithPassword(email,password);
    for(const address of [email,'other@fixture.test']) await admin.collection('users').create({email:address,password,passwordConfirm:password});
    const owner = new PocketBase(pbURL), other = new PocketBase(pbURL);
    const auth = await owner.collection('users').authWithPassword(email,password);
    await other.collection('users').authWithPassword('other@fixture.test',password);
    const template=JSON.parse(await readFile(join(root,'src/lib/templates/personal-crm.json'),'utf8'));
    const project = await owner.collection('_tk_projects').create({name:'Private CRM',kit:'custom',domain:'crm.fixture.test',visibility:'private',frontend_code:template.frontend_code,content:template.content,design:template.design,data:{...template.data,contacts:{schema:[{name:'name',type:'text'}],records:[{id:'contact1',name:'Private contact'}]}}});
    assert.equal(project.owner,auth.record.id);
    const starter=await owner.collection('_tk_projects').create({name:'CRM starter',kit:'custom',settings:{template_id:'personal-crm'}});assert.equal(starter.visibility,'private');assert.equal(starter.owner,auth.record.id);
    const form = new FormData(); form.append('published_html',new Blob(['<!doctype html><h1>Private CRM</h1>'],{type:'text/html'}),'index.html');form.append('assets',new Blob(['private attachment']),'note.txt');
    const uploaded = await owner.collection('_tk_projects').update(project.id,form);
    await admin.collection('_tk_projects').update(project.id,{cli_publication:{definition:{}}});
    const sourceForm = new FormData();for(const [k,v] of Object.entries({project:project.id,digest:'abc123',filename:'logo.svg',published:true})) sourceForm.append(k,String(v));sourceForm.append('file',new Blob(['<svg/>']),'logo.svg');
    const sourceAsset = await admin.collection('_tk_source_assets').create(sourceForm);
    const publicProject = await owner.collection('_tk_projects').create({name:'Existing public app',kit:'custom',domain:'',data:{items:{schema:[],records:[{id:'public1'}]}}});
    track(spawn(process.execPath,['scripts/companion/server.mjs',String(webPort)],{cwd:root,env:{...process.env,POCKETBASE_URL:pbURL,POCKETBASE_ADMIN_EMAIL:email,POCKETBASE_ADMIN_PASSWORD:password,TINYKIT_SETUP_FILE:join(temporary,'unused'),TINYKIT_COMPANION_DIR:'',TINYKIT_COMPANION_ID:''},stdio:['ignore','pipe','pipe']}));
    await ready(async()=> (await fetch(`${server}/api/projects`,{headers:{Authorization:`Bearer ${auth.token}`}})).ok);
    const ownerHeaders={Authorization:`Bearer ${auth.token}`}, otherHeaders={Authorization:`Bearer ${other.authStore.token}`};
    const paths=[`/_tk/data/${project.id}/contacts`,`/_tk/data/${project.id}/contacts/contact1`,`/_tk/config/${project.id}`,`/_tk/realtime/${project.id}`,`/_tk/assets/${project.id}/${uploaded.assets[0]}`,`/_tk/assets/${uploaded.assets[0]}?project_id=${project.id}`,`/_tk/source-assets/${project.id}/abc123/logo.svg`,`/api/projects/${project.id}/export`,`/api/projects/${project.id}/hosted`];
    const escaped=project.id.replace(/^./,char=>'%'+char.charCodeAt(0).toString(16));
    assert.equal((await fetch(server+`/_tk/data/${escaped}/contacts`,{headers:otherHeaders})).status,403,'encoded app IDs must not bypass access checks');
    for(const path of paths) {
      t.diagnostic(path);
      assert.equal((await fetch(server+path)).status,401,path);
      assert.equal((await fetch(server+path,{headers:otherHeaders})).status,403,path);
      const response=await fetch(server+path,{headers:ownerHeaders});assert.equal(response.status,200,path);assert.match(response.headers.get('cache-control'),/no-store/);await response.body?.cancel();
    }
    for(const path of [`/tinykit/preview/${project.id}`,`/tinykit/preview/${project.id}/contacts`]) {
      const denied=await fetch(server+path,{redirect:'manual'});assert.equal(denied.status,303);assert.match(denied.headers.get('location'),/^\/login\?next=/);
      assert.equal((await fetch(server+path,{headers:otherHeaders})).status,403);
      const allowed=await fetch(server+path,{headers:ownerHeaders});assert.equal(allowed.status,200);assert.match(await allowed.text(),/Private CRM/);
    }
    // No authenticated user may steal or expose a private app through the raw SDK.
    await assert.rejects(other.collection('_tk_projects').getOne(project.id),e=>e.status===404);
    await assert.rejects(other.collection('_tk_projects').update(project.id,{visibility:'public'}));
    await assert.rejects(owner.collection('_tk_projects').update(project.id,{owner:other.authStore.record.id}),e=>e.status===403);
    const otherList=await (await fetch(server+'/api/projects',{headers:otherHeaders})).json();assert.ok(!otherList.some(p=>p.id===project.id));
    const filePath=admin.files.getURL(uploaded,uploaded.assets[0]);
    assert.ok([403,404].includes((await fetch(filePath)).status));
    assert.ok([403,404].includes((await fetch(filePath+'?token='+encodeURIComponent(await other.files.getToken()))).status));
    assert.equal((await fetch(filePath+'?token='+encodeURIComponent(await owner.files.getToken()))).status,200);
    await assert.rejects(other.collection('_tk_source_assets').getOne(sourceAsset.id));
    assert.ok([403,404].includes((await fetch(admin.files.getURL(sourceAsset,sourceAsset.file,{token:await other.files.getToken()}))).status));
    // Browser session is HttpOnly; unauthenticated and cross-origin exchanges fail.
    assert.equal((await fetch(server+'/api/auth/session',{method:'POST',headers:{Origin:server}})).status,401);
    assert.equal((await fetch(server+'/api/auth/session',{method:'POST',headers:{...ownerHeaders,Origin:'https://other.test'}})).status,403);
    const session=await fetch(server+'/api/auth/session',{method:'POST',headers:{...ownerHeaders,Origin:server}});assert.equal(session.status,200);
    const setCookie=session.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/SameSite=Lax/i);
    const cookie=setCookie.split(';')[0];
    assert.equal((await fetch(server+`/tinykit/preview/${project.id}`,{headers:{Cookie:cookie}})).status,200);
    const dataURL=server+`/_tk/data/${project.id}/contacts`;
    assert.equal((await fetch(dataURL,{method:'POST',headers:{Cookie:cookie,Origin:'https://other.test','Content-Type':'application/json'},body:'{"name":"blocked"}'})).status,403);
    const created=await fetch(dataURL,{method:'POST',headers:{Cookie:cookie,Origin:server,'Content-Type':'application/json'},body:'{"name":"New contact"}'});assert.equal(created.status,201);
    const live=await created.json();
    assert.equal((await fetch(dataURL+'/'+live.id,{method:'PATCH',headers:{...ownerHeaders,'Content-Type':'application/json'},body:'{"name":"Updated contact"}'})).status,200);
    for(const method of ['POST','PATCH','DELETE']) {const path=method==='POST'?dataURL:dataURL+'/'+live.id;assert.equal((await fetch(path,{method,headers:{...otherHeaders,'Content-Type':'application/json'},...(method==='DELETE'?{}:{body:'{"name":"blocked"}'})})).status,403);}
    assert.equal((await fetch(server+`/_tk/data/${project.id}/contacts/_adjust`,{method:'POST',headers:otherHeaders,body:'{}'})).status,403);
    const signedOut=await fetch(server+'/api/auth/session',{method:'DELETE',headers:{Cookie:cookie,Origin:server}});assert.match(signedOut.headers.get('set-cookie'),/Max-Age=0/);
    assert.equal((await fetch(dataURL)).status,401);
    // Publish and republish the actual CRM, keeping records and privacy intact.
    const exported=await (await fetch(server+`/api/projects/${project.id}/export`,{headers:ownerHeaders})).json();
    assert.equal(exported.visibility,'private');
    const appFolder=join(temporary,'crm');await exportWorkspace(exported,appFolder);
    const cliEnv={...process.env,TINYKIT_TOKEN:auth.token,TINYKIT_CONFIG_DIR:join(temporary,'cli-auth')};
    delete cliEnv.TINYKIT_COMPANION_DIR;delete cliEnv.TINYKIT_COMPANION_ID;delete cliEnv.TINYKIT_TOKEN_FILE;
    const cli=async(...args)=>JSON.parse((await exec(process.execPath,['scripts/tinykit.mjs',...args,appFolder,'--json'],{cwd:root,env:cliEnv,maxBuffer:3000000})).stdout);
    const beforePublish=await admin.collection('_tk_projects').getOne(project.id);
    const published=await cli('push','--publish');assert.equal(published.publish.state,'succeeded');
    await writeFile(join(appFolder,'content.json'),JSON.stringify([{...template.content[0],value:'My private relationships'}]));
    const republished=await cli('push','--publish');assert.equal(republished.publish.state,'succeeded');
    const afterPublish=await admin.collection('_tk_projects').getOne(project.id);
    assert.deepEqual(afterPublish.data,beforePublish.data);assert.deepEqual(afterPublish.assets,beforePublish.assets);assert.equal(afterPublish.owner,auth.record.id);assert.equal(afterPublish.visibility,'private');
    assert.equal((await fetch(republished.public_url,{redirect:'manual'})).status,303);
    assert.equal((await fetch(republished.public_url,{headers:otherHeaders})).status,403);
    const html=await (await fetch(republished.public_url,{headers:ownerHeaders})).text();assert.match(html,/tinykit-definition/);
    assert.equal((await (await fetch(server+`/api/projects/${project.id}/hosted`,{headers:ownerHeaders})).json()).visibility,'private');
    // Snapshot database plus uploads, restore to another directory, and start it.
    await writeFile(join(temporary,'pb_data','.setup_complete'),'fixture-setup-marker');
    await scheduleBackups(admin);assert.equal((await admin.settings.getAll()).backups.cronMaxKeep,14);
    const snapshot=await createBackup(admin,join(temporary,'backups'));
    assert.ok(snapshot.bytes>0);assert.equal((await readFile(snapshot.file+'.sha256','utf8')).split(' ')[0],snapshot.sha256);
    const archive=await unzipper.Open.file(snapshot.file);
    assert.ok(archive.files.some(file=>file.path==='data.db'));
    assert.ok(archive.files.some(file=>file.path==='.setup_complete'),'setup marker must survive backup');
    const restoredData=join(temporary,'restored-data');await archive.extract({path:restoredData});
    const restorePort=await port();const restoreFlags=['--automigrate=false','--dir',restoredData,'--migrationsDir',join(root,'pocketbase/pb_migrations'),'--hooksDir',join(root,'pocketbase/pb_hooks')];
    track(spawn(binary,['serve','--http',`127.0.0.1:${restorePort}`,...restoreFlags],{stdio:['ignore','pipe','pipe']}));
    const restored=new PocketBase(`http://127.0.0.1:${restorePort}`);restored.autoCancellation(false);
    await ready(async()=>(await restored.health.check()).code===200);
    await restored.collection('users').authWithPassword(email,password);
    const recovered=await restored.collection('_tk_projects').getOne(project.id);
    for(const key of ['data','assets','published_html','owner','visibility','content','frontend_code'])assert.deepEqual(recovered[key],afterPublish[key],`restored ${key}`);
    const attachment=await fetch(restored.files.getURL(recovered,recovered.assets[0],{token:await restored.files.getToken()}));assert.equal(await attachment.text(),'private attachment');
    const restoredOther=new PocketBase(restored.baseURL);await restoredOther.collection('users').authWithPassword('other@fixture.test',password);await assert.rejects(restoredOther.collection('_tk_projects').getOne(project.id));
    // Public app data retains its existing behavior after the migration.
    assert.equal((await fetch(server+`/_tk/data/${publicProject.id}/items`)).status,200);
    assert.equal((await fetch(server+`/_tk/data/${publicProject.id}/items`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"name":"Public write"}'})).status,201);
  } catch(error) { error.message += '\n'+JSON.stringify(error.response)+'\n'+logs.slice(-10000); throw error; }
});


test('private-app migration preserves existing source assets, public apps, and custom collection rules', {skip:!process.env.TINYKIT_TEST_PRIVATE,timeout:60000},async t=>{
  const temporary=await mkdtemp(join(tmpdir(),'tinykit-private-upgrade-'));
  const migrationDir=join(temporary,'old-migrations'),dataDir=join(temporary,'data'),hooks=join(temporary,'empty-hooks');await mkdir(migrationDir);await mkdir(hooks);
  for(const file of await readdir(join(root,'pocketbase/pb_migrations')))if(file.endsWith('.js')&&file!=='1793300000_add_private_apps.js')await copyFile(join(root,'pocketbase/pb_migrations',file),join(migrationDir,file));
  const binary=join(root,'pocketbase/pocketbase'),email='migration@fixture.test',password='migration-fixture-password',pbPort=await port();
  const flags=['--automigrate=false','--dir',dataDir,'--migrationsDir',migrationDir,'--hooksDir',hooks];let child;
  async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit'),timer=setTimeout(()=>child.kill('SIGKILL'),2000);child.kill();await done;clearTimeout(timer)}}
  t.after(async()=>{await stop();await rm(temporary,{recursive:true,force:true})});
  await exec(binary,['superuser','upsert',email,password,...flags]);
  async function start(args){child=spawn(binary,['serve','--http',`127.0.0.1:${pbPort}`,...args],{stdio:'ignore'});const pb=new PocketBase(`http://127.0.0.1:${pbPort}`);await ready(async()=>(await pb.health.check()).code===200);await pb.collection('_superusers').authWithPassword(email,password);return pb}
  let admin=await start(flags);
  const project=await admin.collection('_tk_projects').create({name:'Existing public app',kit:'custom',data:{notes:{schema:[],records:[{id:'keep',title:'Keep the record'}]}}});
  const form=new FormData();form.append('project',project.id);form.append('digest','existing');form.append('filename','image.svg');form.append('published','true');form.append('file',new Blob(['original source asset']),'image.svg');
  const asset=await admin.collection('_tk_source_assets').create(form);
  const collection=await admin.collections.getOne('_tk_projects'),rule="@request.auth.id != '' && name != 'hidden'";
  await admin.collections.update(collection.id,{listRule:rule,viewRule:rule,updateRule:null});
  await stop();
  const updatedFlags=['--automigrate=false','--dir',dataDir,'--migrationsDir',join(root,'pocketbase/pb_migrations'),'--hooksDir',join(root,'pocketbase/pb_hooks')];
  await exec(binary,['migrate','up',...updatedFlags]);admin=await start(updatedFlags);
  const upgraded=await admin.collection('_tk_projects').getOne(project.id);assert.deepEqual(upgraded.data,project.data);assert.notEqual(upgraded.visibility,'private');
  const upgradedRules=await admin.collections.getOne('_tk_projects');assert.match(upgradedRules.viewRule,/name != 'hidden'/);assert.equal(upgradedRules.updateRule,null);
  const restoredAsset=await admin.collection('_tk_source_assets').getOne(asset.id);assert.equal(restoredAsset.project,project.id);assert.equal(restoredAsset.file,asset.file);
  const bytes=await fetch(admin.files.getURL(restoredAsset,restoredAsset.file,{token:await admin.files.getToken()}));assert.equal(await bytes.text(),'original source asset');
});
