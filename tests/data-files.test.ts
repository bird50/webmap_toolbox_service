import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../src/service.js';
import {automaticShareTag} from '../src/share-tags.js';

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
