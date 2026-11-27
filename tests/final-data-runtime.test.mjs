import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {parse} from 'acorn';

const source = readFileSync(new URL('../src/lib/compiler/iframe.js', import.meta.url), 'utf8');
const declaration = parse(source, {ecmaVersion:'latest',sourceType:'module'}).body.find(
  item => item.type === 'VariableDeclaration' && item.declarations[0].id.name === 'generate_data_module'
);
const preview = vm.runInNewContext(source.slice(declaration.start, declaration.end) + ';generate_data_module');
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/routes/tinykit/lib/module-generators.ts',import.meta.url),'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,{exports});
const response = value => ({ok:true,json:async()=>value});
const flush = async () => {for(let i=0;i<12;i++)await Promise.resolve();};
function runtime(generate, fetch) {
  const window = {}; window.parent = window;
  const db = vm.runInNewContext(generate('project',['entries']).replace('export default db','db'),{
    window,fetch,URLSearchParams,setTimeout,console,EventSource:class{addEventListener(){}}
  });
  return {collection:db.entries,window};
}

for(const [name,generate] of [['preview',preview],['production',exports.generate_data_module]]) {
  test(`${name}: complete loads include records beyond 100 and retain query options`,async()=>{
    const records=Array.from({length:205},(_,index)=>({id:String(index),value:index})), calls=[];
    const {collection}=runtime(generate,async url=>{
      const query=new URL(url,'http://example.test').searchParams;
      calls.push(query);
      const page=Number(query.get('page')),size=Number(query.get('perPage'));
      return response({items:records.slice((page-1)*size,page*size),totalPages:3});
    });
    const result=await collection.list({all:true,sort:'value',filter:'active=true'});
    assert.equal(result.length,205);
    assert.equal(result.at(-1).id,'204');
    assert.deepEqual(calls.map(query=>query.get('page')),['1','2','3']);
    assert.ok(calls.every(query=>query.get('perPage')==='100' && query.get('sort')==='value' && query.get('filter')==='active=true' && !query.has('all')));
  });

  test(`${name}: explicit pagination still requests only the selected page`,async()=>{
    const calls=[];
    const {collection}=runtime(generate,async url=>{calls.push(url);return response({items:[{id:'selected'}],totalPages:10});});
    assert.equal((await collection.list({page:2,perPage:10}))[0].id,'selected');
    assert.equal(calls.length,1);
    const query=new URL(calls[0],'http://example.test').searchParams;
    assert.equal(query.get('page'),'2');assert.equal(query.get('perPage'),'10');
  });

  test(`${name}: complete loads tolerate malformed legacy rows and deduplicate overlapping pages`,async()=>{
    const {collection}=runtime(generate,async url=>{
      const page=new URL(url,'http://example.test').searchParams.get('page');
      return response({items:page==='1'?[null,{id:'a'}]:[{id:'a'},{id:'b'}],totalPages:2});
    });
    assert.deepEqual(Array.from(await collection.list({all:true}),row=>row?.id??null),[null,'a','b']);
  });

  test(`${name}: a later-page failure preserves the complete previous cache for subsequent edits`,async()=>{
    let failing=false,latest;
    const {collection}=runtime(generate,async(url,options)=>{
      if(options?.method==='PATCH')return response({id:'original',text:'Saved'});
      if(!failing)return response({items:[{id:'original',text:'Original'}],totalPages:1});
      const page=new URL(url,'http://example.test').searchParams.get('page');
      return page==='1'?response({items:[{id:'partial'}],totalPages:2}):{ok:false,text:async()=> 'Page offline'};
    });
    collection.subscribe(rows=>latest=rows,{all:true});await flush();
    failing=true;
    await assert.rejects(collection.list({all:true}),/Page offline/);
    await collection.update('original',{text:'Saved'});
    assert.deepEqual(Array.from(latest,row=>[row.id,row.text]),[['original','Saved']]);
  });

  test(`${name}: a newer live snapshot wins over an older multi-page response`,async()=>{
    let window;
    const live=[{id:'newest',text:'Live'}];
    const app=runtime(generate,async url=>{
      const page=new URL(url,'http://example.test').searchParams.get('page');
      if(page==='2')window.__tk_update_data({entries:{records:live}});
      return response({items:[{id:page}],totalPages:2});
    });window=app.window;
    assert.deepEqual(Array.from(await app.collection.list({all:true}),row=>row.id),['newest']);
  });

  for(const refreshFails of [false,true]) {
    test(`${name}: a late counter response retains newer votes${refreshFails?' even if refresh fails':''}`,async()=>{
      let finish,latest,current=[{id:'a',votes:0}],refreshing=false;
      const {collection,window}=runtime(generate,async(_url,options)=>{
        if(options?.method==='POST')return new Promise(resolve=>finish=resolve);
        if(refreshFails && refreshing)return{ok:false,text:async()=> 'Refresh offline'};
        return response({items:current,totalPages:1});
      });
      collection.subscribe(rows=>latest=rows,{all:true});await flush();
      const adjusting=collection.adjust([{id:'a',field:'votes',delta:1}]);
      current=[{id:'a',votes:7}];window.__tk_update_data({entries:{records:current}});
      refreshing=true;finish(response([{id:'a',votes:1}]));await adjusting;
      assert.equal(latest[0].votes,7);
    });
  }
}
