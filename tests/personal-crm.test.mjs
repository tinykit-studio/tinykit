import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { compile } from 'svelte/compiler';
import { parse } from 'acorn';
const template=JSON.parse(readFileSync(new URL('../src/lib/templates/personal-crm.json',import.meta.url),'utf8'));
function app({failWrite=false}={}) {
  let source=template.frontend_code.match(/<script>([\s\S]*?)<\/script>/)[1];
  for(const node of parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.filter(n=>n.type==='ImportDeclaration').reverse())source=source.slice(0,node.start)+source.slice(node.end);
  const writes=[],callbacks={},cleanups=[];let identifier=0;
  const data=Object.fromEntries(Object.keys(template.data).map(kind=>[kind,{
    subscribe(receive){callbacks[kind]=receive;receive(structuredClone(template.preview_records[kind]));return()=>{}},
    async list(){return structuredClone(template.preview_records[kind])},
    async create(value){if(failWrite)throw Error('offline');writes.push({kind,action:'create',value:structuredClone(value)});return {...value,id:value.id||'new-'+ ++identifier}},
    async update(id,value){if(failWrite)throw Error('offline');writes.push({kind,action:'update',id,value:structuredClone(value)});return {...value,id}},
    async delete(id){writes.push({kind,action:'delete',id})}
  }]));
  const context=vm.createContext({data,content:{title:'Test CRM'},$state:value=>value,$derived:value=>value,$effect:()=>{},onDestroy:fn=>cleanups.push(fn),setInterval:()=>1,clearInterval(){},setTimeout:()=>1,URL,Blob,confirm:()=>true,console});
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  return {run,writes,callbacks,cleanups};
}
const plain=value=>JSON.parse(JSON.stringify(value));
test('CRM compiles for browser and server, with an empty hosted database and separate local examples',()=>{
  for(const generate of ['client','server'])assert.equal(compile(template.frontend_code,{generate}).warnings.length,0);
  assert.equal(template.visibility,'private');
  for(const collection of Object.values(template.data))assert.deepEqual(collection.records,[]);
});
test('contact, company, deal, note and follow-up forms preserve their relationships and data types',async()=>{
  const h=app();
  for(const [kind,values] of Object.entries({
    companies:{name:'New company',website:'company.example',industry:'Design'},
    contacts:{name:'New contact',email:'hello@example.test',company_id:'company-cedar',role:'Owner'},
    deals:{title:'New project',company_id:'company-cedar',contact_id:'contact-maya',stage:'Proposal',value:'1234.56'},
    notes:{body:'A useful conversation.',entity_type:'contacts',entity_id:'contact-maya'},
    followups:{title:'Send the proposal',entity_type:'deals',entity_id:'deal-cedar',due_date:'2026-11-10',done:false}
  })) {
    h.run(`openForm(${JSON.stringify(kind)});Object.assign(form,${JSON.stringify(values)})`);await h.run('save({preventDefault(){}})');assert.equal(h.run('error'),'');assert.equal(h.writes.at(-1).kind,kind);
  }
  assert.equal(h.writes.find(w=>w.kind==='deals').value.value,1234.56);
  assert.equal(h.writes.find(w=>w.kind==='followups').value.done,false);
  assert.equal(h.writes.find(w=>w.kind==='contacts').value.company_id,'company-cedar');
});
test('failed writes retain the exact draft, and invalid dates, amounts and missing relationships are rejected',async()=>{
  const h=app({failWrite:true});h.run("openForm('contacts');form.name='Keep my draft'");await h.run('save({preventDefault(){}})');assert.match(h.run('error'),/Could not save/);assert.equal(h.run('form.name'),'Keep my draft');assert.equal(h.run('formKind'),'contacts');
  for(const [kind,value] of [['deals',{title:'Bad deal',stage:'Lead',value:'abc'}],['deals',{title:'Bad deal',stage:'Lead',value:-1}],['contacts',{name:'Missing company',company_id:'missing'}],['followups',{title:'Bad date',due_date:'2026-02-30'}],['notes',{body:'Unlinked',entity_type:'contacts',entity_id:'missing'}]])assert.throws(()=>h.run(`fields(${JSON.stringify(kind)},${JSON.stringify(value)})`));
});
test('linked entities cannot be deleted, and completing a follow-up updates only its completion',async()=>{
  const h=app();await h.run("remove('companies',companies[0])");assert.match(h.run('error'),/linked/);assert.equal(h.writes.length,0);
  await h.run('complete(followups[0])');assert.deepEqual(plain(h.writes[0]),{kind:'followups',action:'update',id:'followup-maya',value:{done:true}});
});
test('CSV parsing preserves quotes, commas and multiline notes; exports neutralize spreadsheet formulas',()=>{
  const h=app();assert.deepEqual(plain(h.run('parseCsv(\'name,body\\r\\n"A, B","said ""hello""\\nnext line"\\r\\n\')')),[['name','body'],['A, B','said "hello"\nnext line']]);
  assert.throws(()=>h.run('parseCsv(\'"unclosed\')'));
  assert.equal(h.run('csvCell("=SUM(A1:A2)")'),'"\'=SUM(A1:A2)"');
});
test('CSV import reviews changes before writing and preserves IDs when updating existing records',async()=>{
  const h=app();h.run("section='contacts'");
  const text='id,name,email,company_id\ncontact-maya,Maya Updated,new@example.test,company-cedar\nimported-contact,New Person,person@example.test,company-lumen';
  const event={target:{files:[{size:text.length,text:async()=>text}],value:'fixture.csv'}};
  // Invoke with a real async file object while the app code stays in its VM.
  const preview=h.run('previewImport');await preview(event);
  assert.equal(h.writes.length,0);assert.equal(h.run('csvPreview.updates'),1);assert.equal(h.run('csvPreview.imports.length'),2);
  await h.run('importCsv()');assert.equal(h.writes.length,2);assert.equal(h.writes[0].action,'update');assert.equal(h.writes[0].id,'contact-maya');assert.equal(h.writes[1].value.id,'imported-contact');
});
test('CSV validation rejects duplicate IDs and changes during review before any mutation',async()=>{
  const h=app();h.run("section='contacts'");const preview=h.run('previewImport');
  for(const text of ['id,name\nsame,One\nsame,Two','id,name,company_id\nnew,Person,missing','name,unknown\nPerson,x']) {await preview({target:{files:[{size:text.length,text:async()=>text}],value:'fixture'}});assert.equal(h.run('csvPreview'),null);assert.ok(h.run('error'));}
  const text='id,name\nnew,Person';await preview({target:{files:[{size:text.length,text:async()=>text}],value:'fixture'}});h.callbacks.contacts([{id:'newer',name:'Changed remotely'}]);await h.run('importCsv()');assert.equal(h.writes.length,0);assert.match(h.run('error'),/changed during review/);
});
