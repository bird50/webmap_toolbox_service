import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import sharp from "sharp";
import {createService} from "../src/service.js";
async function fixture(gps=true,date=true){
 const jpeg=await sharp({create:{width:64,height:64,channels:3,background:'#087f73'}}).jpeg().toBuffer();
 if(!gps)return jpeg;
 const t=Buffer.alloc(288);t.write('II');t.writeUInt16LE(42,2);t.writeUInt32LE(8,4);t.writeUInt16LE(2,8);
 function tag(off:number,id:number,type:number,count:number,value:number){t.writeUInt16LE(id,off);t.writeUInt16LE(type,off+2);t.writeUInt32LE(count,off+4);t.writeUInt32LE(value,off+8);}
 tag(10,0x8769,4,1,38);tag(22,0x8825,4,1,80);
 t.writeUInt16LE(date?2:0,38);
 if(date){tag(40,0x9003,2,20,200);tag(52,0x9011,2,7,224);t.write('2026:10:18 09:30:45\0',200);t.write('+07:00\0',224);}
 t.writeUInt16LE(4,80);tag(82,1,2,2,78);tag(94,2,5,3,240);tag(106,3,2,2,69);tag(118,4,5,3,264);
 for(const [off,value] of [[240,13],[248,30],[256,0],[264,100],[272,15],[280,0]]){t.writeUInt32LE(value,off);t.writeUInt32LE(1,off+4);}
 const payload=Buffer.concat([Buffer.from('Exif\0\0'),t]);const header=Buffer.from([0xff,0xe1,0,0]);header.writeUInt16BE(payload.length+2,2);
 return Buffer.concat([jpeg.subarray(0,2),header,payload,jpeg.subarray(2)]);
}

test("Public upload from local photos: validation, atomicity, filters and persistence",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"toolbox-test-")),path=join(dir,"test.sqlite"),key="test-service-key-that-is-at-least-32-characters";
 let service=createService(path,key);
 const call=(path:string,method="GET",body?:BodyInit)=>service.handle(new Request(`http://localhost${path}`,{method,headers:{authorization:`Bearer ${key}`,"x-toolbox-owner":"guest:alice","x-toolbox-username":"Alice"},body}));
 const form=async(date=true)=>{const body=new FormData();body.set("eventName","Flood");body.set("tags",JSON.stringify(["survey"]));body.set("captions",JSON.stringify(["  น้ำล้นตลิ่ง  "]));body.append("photos",new File([await fixture(true,date)],"sample.jpg",{type:"image/jpeg"}));return body;};
 try{
 assert.equal((await service.handle(new Request("http://localhost/public/photos"))).status,401);
 assert.equal((await call("/my-photos")).status,404);
 assert.equal((await call("/my-photos","POST",await form())).status,404);
 assert.equal((await call("/public/photos")).status,400);
 const shared=await call("/shares","POST",await form());assert.equal(shared.status,201);const share=await shared.json();
 const query="/public/photos?bbox=90,0,110,20";
 const publicPhotos=(await (await call(query)).json()).photos;assert.equal(publicPhotos.length,1);
 const image=await call(`/shares/${share.id}/photos/${publicPhotos[0].id}`);assert.equal(image.status,200);assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).exif,undefined);
 assert.equal((await (await call(`/shares/${share.id}`)).json()).photos.length,1);
 assert.equal(publicPhotos[0].caption,'น้ำล้นตลิ่ง','captions are trimmed and returned with public photos');
 assert.equal((await (await call(`/shares/${share.id}`)).json()).photos[0].caption,'น้ำล้นตลิ่ง');
 const longCaption=await form();longCaption.set("captions",JSON.stringify(["x".repeat(501)]));assert.equal((await call("/shares","POST",longCaption)).status,400);
 assert.deepEqual([share.appName,share.username],['default','Alice'],'without an app name header the app ID is stored');
 const named=await service.handle(new Request("http://localhost/shares",{method:"POST",headers:{authorization:`Bearer ${key}`,"x-toolbox-owner":"guest:bob","x-toolbox-app-name":encodeURIComponent("ThaiWater GIS")},body:await form()}));
 const anonymous=await named.json();assert.equal(named.status,201);
 assert.deepEqual([anonymous.appName,anonymous.username],['ThaiWater GIS','anonymous'],'no username is stored as anonymous');
 const page=await (await call(`/shares/${anonymous.id}`)).json();assert.deepEqual([page.appName,page.username],['ThaiWater GIS','anonymous']);
 assert.equal((await call(`/shares/${anonymous.id}`,"DELETE")).status,200);
 const sets=await (await call("/public/photo-shares")).json();
 assert.deepEqual(sets.sets.map((set:{id:string;eventName:string;photoCount:number;username:string;tags:string[]})=>[set.id,set.eventName,set.photoCount,set.username,set.tags.includes('survey')]),[[share.id,'Flood',1,'Alice',true]]);
 assert.deepEqual(sets.sets[0].bbox,[100.25,13.5,100.25,13.5]);
 assert.equal(sets.hasMore,false);
 for(const filter of ["eventName=flo","username=ali","tag=survey","startDate=2026-10-18&endDate=2026-10-18","eventName=Flood&tag=survey"])assert.equal((await (await call(`/public/photo-shares?${filter}`)).json()).sets.length,1,filter);
 for(const filter of ["eventName=missing","eventName=Flood&tag=missing","startDate=2026-10-19","offset=1"])assert.equal((await (await call(`/public/photo-shares?${filter}`)).json()).sets.length,0,filter);
 assert.equal((await call("/public/photo-shares?limit=51")).status,400);
 for(const filter of ["eventName=Flood","tag=survey","username=Alice","startDate=2026-10-18&endDate=2026-10-18","eventName=missing&tag=survey"]){assert.equal((await (await call(`${query}&${filter}`)).json()).photos.length,1);}
 assert.equal((await (await call(`${query}&tag=missing`)).json()).photos.length,0);
 assert.equal((await (await call("/public/photos?bbox=170,-20,-170,20")).json()).photos.length,0);
 assert.equal((await call("/shares","POST",await form(false))).status,422);
 const invalid=await form();invalid.append("photos",new File(["invalid"],"bad.jpg",{type:"image/jpeg"}));assert.equal((await call("/shares","POST",invalid)).status,422);
 const badTags=await form();badTags.set("tags","invalid json");assert.equal((await call("/shares","POST",badTags)).status,400);
 const tooMany=await form();for(let i=0;i<10;i++)tooMany.append("photos",new File(["x"],"extra.jpg",{type:"image/jpeg"}));assert.equal((await call("/shares","POST",tooMany)).status,400);
 service.close();service=createService(path,key);
 assert.equal((await (await call(query)).json()).photos.length,1);
 }finally{service.close();rmSync(dir,{recursive:true,force:true});}
});
