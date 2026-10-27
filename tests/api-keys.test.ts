import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createService} from '../src/service.js';
import {openDatabase} from '../src/database.js';
import {createKey,listKeys,revokeKey} from '../src/api-keys.js';

const legacy='legacy-env-key-that-is-at-least-32-characters';
const shape=()=>({id:randomUUID(),tool:'line',points:[[100,13],[101,14]],text:'',style:{color:'#dc2626',background:'#ffffff',border:'#64748b',font:'sans-serif',fontSize:18,width:3,opacity:1,rotation:0,alignment:'left'},boxWidth:200,boxHeight:100});
const temp=()=>{const dir=mkdtempSync(join(tmpdir(),'toolbox-keys-'));return {path:join(dir,'t.sqlite'),done:()=>rmSync(dir,{recursive:true,force:true})};};
function client(service:ReturnType<typeof createService>,key:string,owner='member:1'){
 return (path:string,method='GET',body?:unknown)=>service.handle(new Request(`http://localhost${path}`,{method,headers:{authorization:`Bearer ${key}`,'x-toolbox-owner':owner,'x-toolbox-username':'u','content-type':'application/json'},body:body?JSON.stringify(body):undefined}));
}
const drawings=async(call:ReturnType<typeof client>)=>(await (await call('/public/drawings?bbox=90,0,110,20')).json()).drawings as {shareId:string}[];

test('keys: scopes per route, isolation between apps and immediate revocation',async()=>{
 const {path,done}=temp();
 const db=openDatabase(path);
 const a=createKey(db,{appId:'web-a',scopes:['read','write'],label:'Web A production'});
 const b=createKey(db,{appId:'web-b',scopes:['read']});
 assert.match(a.key,/^tbx_[\w-]{43}$/);
 assert.throws(()=>createKey(db,{appId:'Bad App',scopes:['read']}));
 assert.throws(()=>createKey(db,{appId:'web-c',scopes:['admin']}));
 assert.ok(!JSON.stringify(listKeys(db)).includes(a.key),'only the hash is stored');
 db.close();
 const service=createService(path);
 try{
  const callA=client(service,a.key),callB=client(service,b.key);
  assert.equal((await callA('/drawing-shares','POST',{name:'A',drawings:[shape()]})).status,201);
  assert.equal((await callB('/drawing-shares','POST',{name:'B',drawings:[shape()]})).status,403,'read-only key cannot publish');
  assert.equal((await drawings(callA)).length,1);
  assert.equal((await drawings(callB)).length,0,'apps never see each other’s shares');
  assert.equal((await client(service,'tbx_unknown')('/health')).status,401);
  const control=openDatabase(path);revokeKey(control,b.id);control.close();
  assert.equal((await callB('/health')).status,401,'revocation applies to the next request');
 }finally{service.close();done();}
});

test('delete: owners remove their own shares, moderators any share of their app',async()=>{
 const {path,done}=temp();
 const db=openDatabase(path);
 const writer=createKey(db,{appId:'web-a',scopes:['read','write']}).key,moderator=createKey(db,{appId:'web-a',scopes:['moderate']}).key,other=createKey(db,{appId:'web-b',scopes:['read','write','moderate']}).key;
 db.close();
 const service=createService(path);
 try{
  const alice=client(service,writer,'member:alice'),bob=client(service,writer,'member:bob');
  const first=(await (await alice('/drawing-shares','POST',{name:'1',drawings:[shape()]})).json()).id;
  const second=(await (await alice('/drawing-shares','POST',{name:'2',drawings:[shape()]})).json()).id;
  assert.equal((await bob(`/drawing-shares/${first}`,'DELETE')).status,403,'not the owner');
  assert.equal((await client(service,other)(`/drawing-shares/${first}`,'DELETE')).status,404,'other apps cannot reach it');
  assert.equal((await alice(`/drawing-shares/${first}`,'DELETE')).status,200);
  assert.equal((await client(service,moderator,'admin:1')(`/drawing-shares/${second}`,'DELETE')).status,200);
  assert.equal((await drawings(alice)).length,0);
  assert.equal((await alice(`/shares/${randomUUID()}`,'DELETE')).status,404);
  const audit=new DatabaseSync(path);
  assert.deepEqual((audit.prepare("SELECT action FROM audit WHERE action LIKE '%DELETED' OR action LIKE '%MODERATED' ORDER BY createdAt").all() as {action:string}[]).map(row=>row.action),['DRAWING_SHARE_DELETED','DRAWING_SHARE_MODERATED']);
  assert.equal((audit.prepare('SELECT count(*) AS n FROM drawing_bounds').get() as {n:number}).n,0,'bounds go with their drawings');
  audit.close();
 }finally{service.close();done();}
});

test('migration: rows from before apps belong to the legacy key’s app, and a service needs some key',async()=>{
 const {path,done}=temp();
 const old=new DatabaseSync(path);
 old.exec(`CREATE TABLE drawing_shares(id TEXT PRIMARY KEY,owner TEXT NOT NULL,username TEXT NOT NULL,name TEXT NOT NULL,createdAt INTEGER NOT NULL);
 CREATE TABLE drawings(id TEXT PRIMARY KEY,shareId TEXT NOT NULL REFERENCES drawing_shares(id),data TEXT NOT NULL);
 CREATE TABLE drawing_bounds(rowId INTEGER PRIMARY KEY,minX REAL NOT NULL,maxX REAL NOT NULL,minY REAL NOT NULL,maxY REAL NOT NULL);`);
 const share=randomUUID(),drawing=shape();
 old.prepare('INSERT INTO drawing_shares VALUES(?,?,?,?,?)').run(share,'guest:x','x','old',1);
 const row=old.prepare('INSERT INTO drawings VALUES(?,?,?)').run(drawing.id,share,JSON.stringify(drawing));
 old.prepare('INSERT INTO drawing_bounds VALUES(?,?,?,?,?)').run(row.lastInsertRowid,100,101,13,14);
 old.close();
 assert.throws(()=>createService(path),/No API key/);
 const service=createService(path,legacy,{defaultAppId:'thaiwater'});
 try{
  assert.equal((await drawings(client(service,legacy))).length,1,'old rows stay visible to the legacy key');
  const db=new DatabaseSync(path);
  assert.equal((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version,4);
  assert.equal((db.prepare('SELECT appId FROM drawing_shares').get() as {appId:string}).appId,'thaiwater');
  db.close();
 }finally{service.close();}
 createService(path,legacy).close();
 done();
});
