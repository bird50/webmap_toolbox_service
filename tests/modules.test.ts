import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createService} from '../src/service.js';
import {parseModules} from '../src/modules/index.js';

const key='test-modules-service-key-at-least-32-characters';
const temp=()=>{const dir=mkdtempSync(join(tmpdir(),'toolbox-modules-'));return {path:join(dir,'t.sqlite'),done:()=>rmSync(dir,{recursive:true,force:true})};};
const client=(service:ReturnType<typeof createService>)=>(path:string,method='GET',body?:unknown)=>service.handle(new Request(`http://localhost${path}`,{method,headers:{authorization:`Bearer ${key}`,'x-toolbox-owner':'guest:a','content-type':'application/json'},body:body?JSON.stringify(body):undefined}));
const tables=(path:string)=>{const db=new DatabaseSync(path);try{return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string}[]).map(row=>row.name);}finally{db.close();}};
const shape=()=>({id:randomUUID(),tool:'line',points:[[100,13],[101,14]],text:'',style:{color:'#dc2626',background:'#ffffff',border:'#64748b',font:'sans-serif',fontSize:18,width:3,opacity:1,rotation:0,alignment:'left'},boxWidth:200,boxHeight:100});
const dataShare={name:'จุด',description:'',tags:[],data:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[100.5,13.5]}}]}};

test('TOOLBOX_MODULES: default all, unknown names fail',()=>{
 assert.deepEqual(parseModules(undefined),['photos','drawings','data-files']);
 assert.deepEqual(parseModules(' '),['photos','drawings','data-files']);
 assert.deepEqual(parseModules('photos, drawings,photos'),['photos','drawings']);
 assert.throws(()=>parseModules('photos,maps'),/TOOLBOX_MODULES: Unknown module "maps"/);
 assert.throws(()=>parseModules(','),/TOOLBOX_MODULES/);
 assert.throws(()=>createService(':memory:',key,{modules:[]}));
});

test('a photos-only service answers 404 for other tools and creates none of their tables',async()=>{
 const {path,done}=temp();
 let service=createService(path,key,{modules:['photos']});
 try{
  const call=client(service);
  assert.equal((await call('/public/photo-shares')).status,200);
  for(const [route,method,body] of [['/drawing-shares','POST',{name:'x',drawings:[shape()]}],['/public/drawings?bbox=90,0,110,20','GET'],[`/drawing-shares/${randomUUID()}`,'DELETE'],['/data-file-shares','POST',dataShare],['/public/data-files?bbox=90,0,110,20','GET'],[`/data-file-shares/${randomUUID()}`,'DELETE']] as const){
   const response=await call(route,method,body);
   assert.equal(response.status,404,`${method} ${route}`);assert.deepEqual(await response.json(),{error:'Not found'});
  }
  for(const table of ['drawing_shares','drawings','drawing_bounds','data_file_shares','data_features','data_feature_bounds'])assert.ok(!tables(path).includes(table),table);
  assert.ok(['shares','photos','api_keys','audit'].every(table=>tables(path).includes(table)));
  service.close();
  // Enabling a module later creates its tables on the next start.
  service=createService(path,key);
  assert.equal((await client(service)('/drawing-shares','POST',{name:'x',drawings:[shape()]})).status,201);
  assert.ok(tables(path).includes('data_file_shares'));
 }finally{service.close();done();}
});

test('a fresh database and an upgraded pre-1.1 database end with the same schema',()=>{
 const describe=(path:string)=>{const db=new DatabaseSync(path);try{
  const names=(db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]).map(row=>row.name);
  return names.map(name=>[name,db.prepare('SELECT name,type,"notnull",dflt_value,pk FROM pragma_table_info(?) ORDER BY name').all(name)]);
 }finally{db.close();}};
 const fresh=temp(),old=temp();
 try{
  createService(fresh.path,key).close();
  const db=new DatabaseSync(old.path);db.exec('CREATE TABLE drawing_shares(id TEXT PRIMARY KEY,owner TEXT NOT NULL,username TEXT NOT NULL,name TEXT NOT NULL,createdAt INTEGER NOT NULL)');db.close();
  createService(old.path,key).close();
  assert.deepEqual(describe(old.path),describe(fresh.path));
 }finally{fresh.done();old.done();}
});

test('a 1.4 database (user_version 4) keeps its rows, including those of disabled modules',async()=>{
 const {path,done}=temp();
 const old=new DatabaseSync(path);
 old.exec(`CREATE TABLE drawing_shares(id TEXT PRIMARY KEY,owner TEXT NOT NULL,username TEXT NOT NULL,name TEXT NOT NULL,createdAt INTEGER NOT NULL,appId TEXT NOT NULL DEFAULT '',appName TEXT NOT NULL DEFAULT '');
 CREATE TABLE drawings(id TEXT PRIMARY KEY,shareId TEXT NOT NULL REFERENCES drawing_shares(id),data TEXT NOT NULL);
 CREATE TABLE drawing_bounds(rowId INTEGER PRIMARY KEY,minX REAL NOT NULL,maxX REAL NOT NULL,minY REAL NOT NULL,maxY REAL NOT NULL);
 CREATE TABLE shares(id TEXT PRIMARY KEY,owner TEXT NOT NULL,username TEXT NOT NULL,eventName TEXT NOT NULL,tags TEXT NOT NULL,createdAt INTEGER NOT NULL,appId TEXT NOT NULL DEFAULT '',appName TEXT NOT NULL DEFAULT '');
 CREATE TABLE photos(id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,longitude REAL NOT NULL,latitude REAL NOT NULL,capturedAt TEXT,capturedOffset TEXT,createdAt INTEGER NOT NULL,expiresAt INTEGER,shareId TEXT REFERENCES shares(id),image BLOB NOT NULL,caption TEXT NOT NULL DEFAULT '');
 CREATE TABLE audit(id TEXT PRIMARY KEY,owner TEXT NOT NULL,action TEXT NOT NULL,resourceId TEXT NOT NULL,createdAt INTEGER NOT NULL,appId TEXT NOT NULL DEFAULT '');
 CREATE TABLE api_keys(id TEXT PRIMARY KEY,appId TEXT NOT NULL,scopes TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,label TEXT NOT NULL,createdAt INTEGER NOT NULL,revokedAt INTEGER);
 CREATE TABLE data_file_shares(id TEXT PRIMARY KEY,appId TEXT NOT NULL,owner TEXT NOT NULL,username TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,tags TEXT NOT NULL,featureCount INTEGER NOT NULL,createdAt INTEGER NOT NULL,appName TEXT NOT NULL DEFAULT '');
 CREATE TABLE data_features(id INTEGER PRIMARY KEY,shareId TEXT NOT NULL REFERENCES data_file_shares(id),data TEXT NOT NULL);
 CREATE TABLE data_feature_bounds(featureId INTEGER PRIMARY KEY REFERENCES data_features(id),minX REAL NOT NULL,maxX REAL NOT NULL,minY REAL NOT NULL,maxY REAL NOT NULL);
 PRAGMA user_version=4;`);
 const photoShare=randomUUID(),drawingShare=randomUUID(),dataFileShare=randomUUID(),drawing=shape();
 old.prepare('INSERT INTO shares VALUES(?,?,?,?,?,?,?,?)').run(photoShare,'guest:a','Alice','Flood','[]',1,'default','ThaiWater');
 old.prepare('INSERT INTO photos VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'guest:a','a.jpg',100.5,13.5,'2026-10-18T09:30:45',null,1,null,photoShare,new Uint8Array([1]),'น้ำท่วม');
 old.prepare('INSERT INTO drawing_shares VALUES(?,?,?,?,?,?,?)').run(drawingShare,'guest:a','Alice','แนว',1,'default','ThaiWater');
 const row=old.prepare('INSERT INTO drawings VALUES(?,?,?)').run(drawing.id,drawingShare,JSON.stringify(drawing));
 old.prepare('INSERT INTO drawing_bounds VALUES(?,?,?,?,?)').run(row.lastInsertRowid,100,101,13,14);
 old.prepare('INSERT INTO data_file_shares VALUES(?,?,?,?,?,?,?,?,?,?)').run(dataFileShare,'default','guest:a','Alice','จุด','','[]',1,1,'ThaiWater');
 const feature=old.prepare('INSERT INTO data_features(shareId,data) VALUES(?,?)').run(dataFileShare,JSON.stringify(dataShare.data.features[0]));
 old.prepare('INSERT INTO data_feature_bounds VALUES(?,?,?,?,?)').run(feature.lastInsertRowid,100.5,100.5,13.5,13.5);
 old.close();
 let service=createService(path,key,{modules:['photos']});
 try{
  let call=client(service);
  const sets=(await (await call('/public/photo-shares')).json()).sets;
  assert.deepEqual(sets.map((set:{id:string;appName:string})=>[set.id,set.appName]),[[photoShare,'ThaiWater']]);
  assert.equal((await (await call('/public/photos?bbox=90,0,110,20')).json()).photos[0].caption,'น้ำท่วม');
  assert.equal((await call('/public/drawings?bbox=90,0,110,20')).status,404);
  service.close();
  const db=new DatabaseSync(path);
  assert.equal((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version,4,'the legacy version is never renumbered');
  assert.deepEqual(db.prepare('SELECT module,version FROM schema_modules ORDER BY module').all().map(row=>({...row})),[{module:'core',version:1},{module:'data-files',version:1},{module:'drawings',version:1},{module:'photos',version:1}]);
  assert.equal((db.prepare('SELECT count(*) AS n FROM drawing_shares').get() as {n:number}).n,1);
  db.close();
  service=createService(path,key);call=client(service);
  assert.equal((await (await call('/public/drawings?bbox=90,0,110,20')).json()).drawings[0].shareId,drawingShare);
  assert.equal((await (await call('/public/data-files?bbox=90,0,110,20')).json()).features[0].properties.share_id,dataFileShare);
  assert.equal((await call('/drawing-shares','POST',{name:'ใหม่',drawings:[shape()]})).status,201,'an adopted database takes new rows');
 }finally{service.close();done();}
});
