import {randomUUID} from 'node:crypto';
import {boundedFormData,prepareSharedPhoto,PhotoUploadError} from '../upload.js';
import {shareFields,automaticShareTag,photoCaptions} from '../photo-share.js';
import {publicPhotoQuery} from '../public-photo-query.js';
import {publicPhotoSetQuery} from '../public-photo-sets.js';
import {deleteShare,id,type ToolModule} from './context.js';

type Row={id:string;name:string;longitude:number;latitude:number;capturedAt:string|null;capturedOffset:string|null;createdAt:number;expiresAt:number|null;shareId?:string|null;caption?:string;eventName?:string;tags?:string;username?:string;image:Uint8Array};
const meta=(p:Row)=>({id:p.id,name:p.name,longitude:p.longitude,latitude:p.latitude,capturedAt:p.capturedAt,capturedOffset:p.capturedOffset,createdAt:p.createdAt,expiresAt:p.expiresAt,url:`/api/photo-shares/${p.shareId}/photos/${p.id}`,...(p.caption?{caption:p.caption}:{}),shareUrl:p.shareId?`/share/${p.shareId}`:undefined,...(p.tags?{tags:JSON.parse(p.tags),eventName:p.eventName,username:p.username}:{})});
const columns='p.id,p.name,p.longitude,p.latitude,p.capturedAt,p.capturedOffset,p.createdAt,p.expiresAt,p.shareId,p.caption';

/** Public photo sets: POST /shares, GET /public/photos, GET /public/photo-shares, GET|DELETE /shares/:id, GET /shares/:id/photos/:photoId. */
export const photos:ToolModule={name:'photos',
 migrations:[
  // v1: the tables as a 1.4 database (user_version 4) has them.
  db=>db.exec(`CREATE TABLE shares(id TEXT PRIMARY KEY,owner TEXT NOT NULL,username TEXT NOT NULL,eventName TEXT NOT NULL,tags TEXT NOT NULL,createdAt INTEGER NOT NULL,appId TEXT NOT NULL DEFAULT '',appName TEXT NOT NULL DEFAULT '');
  CREATE TABLE photos(id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,longitude REAL NOT NULL,latitude REAL NOT NULL,capturedAt TEXT,capturedOffset TEXT,createdAt INTEGER NOT NULL,expiresAt INTEGER,shareId TEXT REFERENCES shares(id),image BLOB NOT NULL,caption TEXT NOT NULL DEFAULT '');
  CREATE INDEX photos_owner_expiry ON photos(owner,expiresAt);
  CREATE INDEX photos_viewport ON photos(latitude,longitude) WHERE shareId IS NOT NULL;
  CREATE INDEX photos_share ON photos(shareId);
  CREATE INDEX shares_app ON shares(appId,createdAt);`),
 ],
 async handle(context){
 const {db,request,url,path,app,json,denied,who,transaction,audit}=context;
 if(path==='/shares'&&request.method==='POST'){
 const forbidden=denied('write');if(forbidden)return forbidden;
 const {owner,username,appName}=who();
 const form=await boundedFormData(request);
 const fields=shareFields.parse({eventName:form.get('eventName'),tags:JSON.parse(String(form.get('tags')??'[]'))});
 const files=form.getAll('photos');
 const captions=photoCaptions.parse(JSON.parse(String(form.get('captions')??'[]')));
 if(!files.length||files.length>10||files.some(file=>!(file instanceof File)))throw new PhotoUploadError('เลือกภาพ 1–10 รูป');
 const photos:Awaited<ReturnType<typeof prepareSharedPhoto>>[]=[];
 for(const [index,file] of (files as File[]).entries())photos.push(await prepareSharedPhoto(file,index));
 const result=transaction(()=>{
 const shareId=randomUUID(),tags=[automaticShareTag(),...new Set(fields.tags)];
 db.prepare('INSERT INTO shares(id,owner,username,eventName,tags,createdAt,appId,appName) VALUES(?,?,?,?,?,?,?,?)').run(shareId,owner,username,fields.eventName,JSON.stringify(tags),Date.now(),app,appName);
 for(const [index,p] of photos.entries())db.prepare('INSERT INTO photos(id,owner,name,longitude,latitude,capturedAt,capturedOffset,createdAt,expiresAt,shareId,image,caption) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),owner,p.name,p.longitude,p.latitude,p.capturedAt,p.capturedOffset,Date.now(),null,shareId,p.image,captions[index]??'');
 audit(owner,'PHOTO_SHARE_PUBLISHED',shareId);return {id:shareId,tags,url:`/share/${shareId}`,appName,username};});return json(result,201);
 }
 if(path==='/public/photo-shares'&&request.method==='GET'){
 const forbidden=denied('read');if(forbidden)return forbidden;
 const q=publicPhotoSetQuery.parse(Object.fromEntries(url.searchParams));
 const args:(string|number)[]=[app];const filters:string[]=[];
 if(q.eventName){filters.push('instr(lower(s.eventName),lower(?))>0');args.push(q.eventName);}
 if(q.username){filters.push('instr(lower(s.username),lower(?))>0');args.push(q.username);}
 if(q.tag){filters.push('EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value=?)');args.push(q.tag);}
 if(q.startDate||q.endDate){filters.push('EXISTS (SELECT 1 FROM photos q WHERE q.shareId=s.id AND q.capturedAt>=? AND q.capturedAt<=?)');args.push(q.startDate?`${q.startDate}T00:00:00`:'0000',q.endDate?`${q.endDate}T23:59:59`:'9999');}
 args.push(q.limit+1,q.offset);
 const rows=db.prepare(`SELECT s.id,s.eventName,s.tags,s.username,s.appName,s.createdAt,count(p.id) AS photoCount,min(p.capturedAt) AS capturedFrom,max(p.capturedAt) AS capturedTo,min(p.longitude) AS west,min(p.latitude) AS south,max(p.longitude) AS east,max(p.latitude) AS north FROM shares s JOIN photos p ON p.shareId=s.id WHERE s.appId=? ${filters.map(filter=>`AND ${filter}`).join(' ')} GROUP BY s.id ORDER BY s.createdAt DESC,s.id DESC LIMIT ? OFFSET ?`).all(...args) as {id:string;eventName:string;tags:string;username:string;appName:string;createdAt:number;photoCount:number;capturedFrom:string|null;capturedTo:string|null;west:number;south:number;east:number;north:number}[];
 return json({sets:rows.slice(0,q.limit).map(row=>({id:row.id,eventName:row.eventName,tags:JSON.parse(row.tags),username:row.username,appName:row.appName,createdAt:row.createdAt,photoCount:row.photoCount,capturedFrom:row.capturedFrom,capturedTo:row.capturedTo,bbox:[row.west,row.south,row.east,row.north],url:`/share/${row.id}`})),hasMore:rows.length>q.limit});
 }
 if(path==='/public/photos'&&request.method==='GET'){
 const forbidden=denied('read');if(forbidden)return forbidden;
 const q=publicPhotoQuery.parse(Object.fromEntries(url.searchParams));const [w,s,e,n]=q.bbox;
 const args:(string|number)[]=[app,s,n,w,e];const filters:string[]=[];
 if(q.username){filters.push('instr(lower(s.username),lower(?))>0');args.push(q.username);}
 if(q.eventName){filters.push('instr(lower(s.eventName),lower(?))>0');args.push(q.eventName);}
 if(q.tag){filters.push('EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value=?)');args.push(q.tag);}
 if(q.startDate||q.endDate){filters.push('(p.capturedAt>=? AND p.capturedAt<=?)');args.push(q.startDate?`${q.startDate}T00:00:00`:'0000',q.endDate?`${q.endDate}T23:59:59`:'9999');}
 args.push(q.limit+1);
 const rows=db.prepare(`SELECT ${columns},s.eventName,s.tags,s.username FROM photos p JOIN shares s ON s.id=p.shareId WHERE s.appId=? AND p.latitude BETWEEN ? AND ? AND (p.longitude>=? ${w<e?'AND':'OR'} p.longitude<=?) ${filters.length?`AND (${filters.join(' OR ')})`:''} ORDER BY p.createdAt DESC,p.id DESC LIMIT ?`).all(...args) as Row[];
 return json({photos:rows.slice(0,q.limit).map(meta),hasMore:rows.length>q.limit});
 }
 const shareMatch=path.match(/^\/shares\/([^/]+)$/);
 if(shareMatch&&request.method==='DELETE')return deleteShare(context,shareMatch[1],{table:'shares',label:'PHOTO',remove:shareId=>{db.prepare('DELETE FROM photos WHERE shareId=?').run(shareId);db.prepare('DELETE FROM shares WHERE id=?').run(shareId);}});
 if(shareMatch&&request.method==='GET'){const forbidden=denied('read');if(forbidden)return forbidden;const shareId=id.parse(shareMatch[1]);const share=db.prepare('SELECT id,eventName,tags,username,appName FROM shares WHERE id=? AND appId=?').get(shareId,app) as {id:string;eventName:string;tags:string;username:string;appName:string}|undefined;if(!share)return json({error:'ไม่พบข้อมูล'},404);return json({...share,tags:JSON.parse(share.tags),photos:(db.prepare(`SELECT ${columns} FROM photos p WHERE shareId=? ORDER BY createdAt,id LIMIT 10`).all(shareId) as Row[]).map(meta)});}
 const publicMatch=path.match(/^\/shares\/([^/]+)\/photos\/([^/]+)$/);
 if(publicMatch&&request.method==='GET'){
 const forbidden=denied('read');if(forbidden)return forbidden;
 const photo=db.prepare('SELECT p.image FROM photos p JOIN shares s ON s.id=p.shareId WHERE p.id=? AND p.shareId=? AND s.appId=?').get(id.parse(publicMatch[2]),id.parse(publicMatch[1]),app);
 if(!photo)return json({error:'ไม่พบภาพ'},404);
 return new Response(new Uint8Array(photo.image as Uint8Array),{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
 return undefined;
 }};
