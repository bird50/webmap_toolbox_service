import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../src/service.js';
import {automaticShareTag} from '../src/share-tags.js';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/database.js';
import {createKey} from '../src/api-keys.js';
import {publicDataFileSetResponse,publicDataFileShare} from '../src/public-data-file-sets.js';

const key='test-data-files-service-key-at-least-32-characters';
const point=(x:number,y:number,properties:Record<string,unknown>={})=>({type:'Feature',properties,geometry:{type:'Point',coordinates:[x,y]}});
const share=(extra:Record<string,unknown>={})=>({name:'จุดวัดระดับน้ำ',description:'สำรวจภาคสนาม',tags:['survey'],data:{type:'FeatureCollection',features:[point(100.5,13.7,{name:'a',level:1.5,share_name:'spoof'}),point(100.6,13.8,{name:'b'})]},...extra});

test('data file shares: validation, tags, viewport and filter queries, deletion',async()=>{
 const service=createService(':memory:',key);
 const call=(path:string,body?:unknown,method=body?'POST':'GET',owner='guest:a')=>service.handle(new Request(`http://localhost${path}`,{method,headers:{authorization:`Bearer ${key}`,'x-toolbox-owner':owner,'x-toolbox-username':encodeURIComponent('สมชาย'),'content-type':'application/json'},body:body?JSON.stringify(body):undefined}));
 try{
  for(const invalid of [share({name:' '}),share({tags:['share2026-01-01']}),share({tags:Array.from({length:11},(_,i)=>`t${i}`)}),share({data:{type:'FeatureCollection',features:[]}}),share({data:{type:'FeatureCollection',features:[point(200,13)]}})])
   assert.equal((await call('/data-file-shares',invalid)).status,400);
  const created=await call('/data-file-shares',share());assert.equal(created.status,201);
  const result=await created.json();
  assert.deepEqual([result.count,result.tags],[2,[automaticShareTag(),'survey']]);
  const view='/public/data-files?bbox=100,13,101,14';
  const listed=await (await call(view)).json();
  assert.equal(listed.features.length,2);assert.equal(listed.hasMore,false);
  const first=listed.features.find((f:{properties:{name:string}})=>f.properties.name==='a');
  assert.deepEqual([first.properties.level,first.properties.share_name,first.properties.share_username,first.properties.share_id],[1.5,'จุดวัดระดับน้ำ','สมชาย',result.id],'share properties replace spoofed ones');
  assert.equal(first.properties.owner,undefined);
  assert.equal((await (await call('/public/data-files?bbox=0,0,5,5')).json()).features.length,0);
  for(const [filter,count] of [['tag=survey',2],['tag=missing',0],['search=ภาคสนาม',2],['search=สมชาย',2],['search=survey&tag=survey',0],['limit=1',1]] as const)
   assert.equal((await (await call(`${view}&${filter}`)).json()).features.length,count,filter);
  assert.equal((await call('/public/data-files?bbox=100,13,101,14&limit=5000')).status,400);
  assert.equal((await call(`/data-file-shares/${result.id}`,undefined,'DELETE')).status,200);
  assert.equal((await (await call(view)).json()).features.length,0);
 }finally{service.close();}
});

test('data file sets: search by name, username, tag and date (AND), newest first; one set with its features; per app',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'toolbox-data-file-sets-')),path=join(dir,'t.sqlite');
 const db=openDatabase(path);const other=createKey(db,{appId:'web-b',scopes:['read']}).key;db.close();
 const service=createService(path,key);
 const call=(path:string,body?:unknown,{username='สมชาย',token=key}:{username?:string;token?:string}={})=>service.handle(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'x-toolbox-owner':'guest:a','x-toolbox-username':encodeURIComponent(username),'x-toolbox-app-name':encodeURIComponent('ThaiWater GIS'),'content-type':'application/json'},body:body?JSON.stringify(body):undefined}));
 const search=async(query='',token=key)=>{const response=await call(`/public/data-file-shares?${query}`,undefined,{token});assert.equal(response.status,200,query);return publicDataFileSetResponse.parse(await response.json());};
 try{
  const first=await (await call('/data-file-shares',share())).json();
  await new Promise(resolve=>setTimeout(resolve,5));
  const second=await (await call('/data-file-shares',share({name:'แนวคลอง',tags:['canal'],data:{type:'FeatureCollection',features:[point(99,12),point(99.5,12.5)]}}),{username:''})).json();
  const all=await search();
  assert.deepEqual(all.sets.map(set=>set.id),[second.id,first.id],'newest first');
  assert.deepEqual({...all.sets[1],createdAt:0},{id:first.id,name:'จุดวัดระดับน้ำ',description:'สำรวจภาคสนาม',tags:[automaticShareTag(),'survey'],username:'สมชาย',appName:'ThaiWater GIS',createdAt:0,featureCount:2,bbox:[100.5,13.7,100.6,13.8]});
  assert.equal(all.sets[0].username,'anonymous');
  const today=automaticShareTag().slice(5);
  for(const [query,ids] of [['name=คลอง',[second.id]],['username=สม',[first.id]],['tag=survey',[first.id]],['tag=canal&username=สม',[]],[`startDate=${today}&endDate=${today}`,[second.id,first.id]],['startDate=2000-01-01&endDate=2000-01-02',[]],['limit=1',[second.id]],['offset=1',[first.id]]] as const)
   assert.deepEqual((await search(query)).sets.map(set=>set.id),ids,query);
  assert.equal((await search('limit=1')).hasMore,true);
  for(const invalid of ['limit=51','startDate=2026-02-30','startDate=2026-10-02&endDate=2026-10-01'])assert.equal((await call(`/public/data-file-shares?${invalid}`)).status,400,invalid);
  const one=publicDataFileShare.parse(await (await call(`/data-file-shares/${first.id}`)).json());
  assert.deepEqual([one.name,one.description,one.tags,one.username,one.data.features.length],['จุดวัดระดับน้ำ','สำรวจภาคสนาม',[automaticShareTag(),'survey'],'สมชาย',2]);
  assert.equal((await call(`/data-file-shares/${randomUUID()}`)).status,404);
  assert.equal((await call('/data-file-shares/not-an-id')).status,400);
  assert.equal((await call(`/data-file-shares/${first.id}`,undefined,{token:other})).status,404,'other apps cannot read the set');
  assert.equal((await search('',other)).sets.length,0);
 }finally{service.close();rmSync(dir,{recursive:true,force:true});}
});
