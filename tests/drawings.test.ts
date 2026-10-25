import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createService} from '../src/service.js';
const key='test-drawings-service-key-at-least-32-characters';
const shape=()=>({id:randomUUID(),tool:'line',points:[[100,13],[101,14]],text:'สำรวจ',style:{color:'#dc2626',background:'#ffffff',border:'#64748b',font:'sans-serif',fontSize:18,width:3,opacity:1,rotation:0,alignment:'left'},boxWidth:200,boxHeight:100});
test('drawing publication validates geometry/styles, indexes bounds and limits public queries',async()=>{
 const service=createService(':memory:',key);
 const call=(path:string,body?:unknown)=>service.handle(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${key}`,'x-toolbox-owner':'guest:test','x-toolbox-username':'tester','content-type':'application/json'},body:body?JSON.stringify(body):undefined}));
 try{
 assert.equal((await service.handle(new Request('http://localhost/drawing-shares',{method:'POST',body:'{}'}))).status,401);
 for(const d of [{...shape(),points:[[181,0]]},{...shape(),points:[[100,13]]},{...shape(),style:{...shape().style,color:'url(https://bad)'}},{...shape(),tool:'polygon',points:[[100,13],[101,13],[101,14],[100,14]]}])assert.equal((await call('/drawing-shares',{name:'invalid',drawings:[d]})).status,400);
 assert.equal((await call('/public/drawings')).status,400);
 assert.equal((await call('/drawing-shares',{name:'สำรวจ',drawings:[shape()]})).status,201);
 const result=await (await call('/public/drawings?bbox=100.4,13.4,100.6,13.6')).json();
 assert.equal(result.drawings.length,1);assert.equal(result.drawings[0].text,'สำรวจ');assert.equal(result.drawings[0].style.color,'#dc2626');assert.equal(result.hasMore,false);assert.equal(result.drawings[0].owner,undefined);
 assert.equal((await (await call('/public/drawings?bbox=0,0,5,5')).json()).drawings.length,0);
 assert.equal((await (await call('/public/drawings?bbox=170,-20,-170,20')).json()).drawings.length,0);
 const duplicate=shape();assert.equal((await call('/drawing-shares',{name:'duplicate',drawings:[duplicate,duplicate]})).status,400);
 assert.equal((await call('/drawing-shares',{name:'many',drawings:Array.from({length:60},shape)})).status,201);
 const bounded=await (await call('/public/drawings?bbox=90,0,110,20&limit=200')).json();assert.equal(bounded.drawings.length,50);assert.equal(bounded.hasMore,true);
 }finally{service.close();}
});
