import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createService} from '../src/service.js';
import {openDatabase} from '../src/database.js';
import {createKey} from '../src/api-keys.js';
import {automaticShareTag} from '../src/share-tags.js';
import {publicDrawingSetResponse,publicDrawingShare} from '../src/public-drawing-sets.js';
const key='test-drawing-sets-service-key-at-least-32-characters';
const shape=(points=[[100,13],[101,14]])=>({id:randomUUID(),tool:'line',points,text:'',style:{color:'#dc2626',background:'#ffffff',border:'#64748b',font:'sans-serif',fontSize:18,width:3,opacity:1,rotation:0,alignment:'left'},boxWidth:200,boxHeight:100});
const temp=()=>{const dir=mkdtempSync(join(tmpdir(),'toolbox-drawing-sets-'));return {path:join(dir,'t.sqlite'),done:()=>rmSync(dir,{recursive:true,force:true})};};
const client=(service:ReturnType<typeof createService>,token=key,username='Alice')=>(path:string,body?:unknown)=>service.handle(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'x-toolbox-owner':'guest:test','x-toolbox-username':username,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}));
const sets=async(call:ReturnType<typeof client>,query='')=>{const response=await call(`/public/drawing-shares${query}`);assert.equal(response.status,200,query);return publicDrawingSetResponse.parse(await response.json());};

test('drawing sets: tags, set search filters and set detail',async()=>{
 const {path,done}=temp();
 const db=openDatabase(path);const other=createKey(db,{appId:'web-b',scopes:['read']}).key;db.close();
 const service=createService(path,key);
 const alice=client(service),bob=client(service,key,'Bob');
 try{
  for(const tags of [['share2026-01-01'],Array.from({length:11},(_,i)=>`t${i}`)])assert.equal((await alice('/drawing-shares',{name:'x',tags,drawings:[shape()]})).status,400);
  const flood=await alice('/drawing-shares',{name:'แนวน้ำท่วม',tags:['flood','flood'],drawings:[shape(),shape([[99,12],[100,15]])]});assert.equal(flood.status,201);
  const first=await flood.json();
  assert.deepEqual(first.tags,[automaticShareTag(),'flood'],'automatic tag first, duplicates removed');
  await new Promise(resolve=>setTimeout(resolve,5));
  const untagged=await (await bob('/drawing-shares',{name:'Survey route',drawings:[shape()]})).json();
  assert.deepEqual(untagged.tags,[automaticShareTag()],'tags are optional');
  const all=await sets(alice);
  assert.deepEqual(all.sets.map(set=>set.id),[untagged.id,first.id],'newest first');
  assert.deepEqual(all.sets[1],{id:first.id,name:'แนวน้ำท่วม',tags:[automaticShareTag(),'flood'],username:'Alice',appName:'default',createdAt:all.sets[1].createdAt,drawingCount:2,bbox:[99,12,101,15]});
  assert.equal(all.hasMore,false);
  const today=automaticShareTag().slice(5),later=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  for(const [query,ids] of [
   ['?name=น้ำ',[first.id]],['?name=SURVEY',[untagged.id]],['?username=bo',[untagged.id]],['?tag=flood',[first.id]],['?tag=floo',[]],
   [`?tag=${automaticShareTag()}`,[untagged.id,first.id]],[`?startDate=${today}&endDate=${today}`,[untagged.id,first.id]],[`?startDate=${later}`,[]],['?endDate=2020-01-01',[]],
   ['?name=น้ำ&tag=flood&username=ali',[first.id]],['?name=น้ำ&username=bob',[]],['?offset=1',[first.id]],['?limit=1',[untagged.id]],
  ] as const)assert.deepEqual((await sets(alice,query)).sets.map(set=>set.id),ids,query);
  assert.equal((await sets(alice,'?limit=1')).hasMore,true);
  for(const query of ['?limit=51','?offset=-1','?startDate=2026-02-30',`?startDate=${later}&endDate=${today}`])assert.equal((await alice(`/public/drawing-shares${query}`)).status,400,query);
  const detail=await alice(`/drawing-shares/${first.id}`);assert.equal(detail.status,200);
  const share=publicDrawingShare.parse(await detail.json());
  assert.deepEqual([share.name,share.tags,share.username,share.drawings.length,share.drawings[1].points[0]],['แนวน้ำท่วม',[automaticShareTag(),'flood'],'Alice',2,[99,12]]);
  assert.equal((await alice(`/drawing-shares/${randomUUID()}`)).status,404);
  assert.equal((await alice('/drawing-shares/not-a-uuid')).status,400);
  const otherApp=client(service,other);
  assert.equal((await otherApp(`/drawing-shares/${first.id}`)).status,404,'other apps cannot read the set');
  assert.equal((await sets(otherApp)).sets.length,0);
  assert.equal((await (await alice('/public/drawings?bbox=90,0,110,20')).json()).drawings.length,3,'the viewport route still works');
 }finally{service.close();done();}
});

test('migration: drawing sets published before tags get an empty tag list',async()=>{
 const {path,done}=temp();
 const old=new DatabaseSync(path);
 old.exec(`CREATE TABLE drawing_shares(id TEXT PRIMARY KEY,owner TEXT NOT NULL,username TEXT NOT NULL,name TEXT NOT NULL,createdAt INTEGER NOT NULL);
 CREATE TABLE drawings(id TEXT PRIMARY KEY,shareId TEXT NOT NULL REFERENCES drawing_shares(id),data TEXT NOT NULL);
 CREATE TABLE drawing_bounds(rowId INTEGER PRIMARY KEY,minX REAL NOT NULL,maxX REAL NOT NULL,minY REAL NOT NULL,maxY REAL NOT NULL);`);
 const shareId=randomUUID(),drawing=shape();
 old.prepare('INSERT INTO drawing_shares VALUES(?,?,?,?,?)').run(shareId,'guest:x','x','old',1);
 const row=old.prepare('INSERT INTO drawings VALUES(?,?,?)').run(drawing.id,shareId,JSON.stringify(drawing));
 old.prepare('INSERT INTO drawing_bounds VALUES(?,?,?,?,?)').run(row.lastInsertRowid,100,101,13,14);
 old.close();
 const service=createService(path,key);
 try{
  const call=client(service);
  assert.deepEqual((await sets(call)).sets.map(set=>[set.id,set.tags,set.drawingCount]),[[shareId,[],1]]);
  assert.deepEqual((await (await call(`/drawing-shares/${shareId}`)).json()).tags,[]);
  const db=new DatabaseSync(path);
  assert.equal((db.prepare("SELECT version FROM schema_modules WHERE module='drawings'").get() as {version:number}).version,2);
  db.close();
 }finally{service.close();done();}
});
