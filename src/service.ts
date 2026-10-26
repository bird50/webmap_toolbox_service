import {randomUUID, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {boundedFormData,prepareSharedPhoto,PhotoUploadError} from './upload.js';
import {shareFields,automaticShareTag} from './photo-share.js';
import {dataFileShareSchema,MAX_DATA_SHARE_BYTES,positions,publicDataFileQuery} from './data-file-share.js';
import {publicPhotoQuery} from './public-photo-query.js';
import {drawingShareSchema} from './drawing-contract.js';
import {openDatabase} from './database.js';
import {activeKeyCount,resolveKey,SCOPES,type Caller,type Scope} from './api-keys.js';
const id=z.string().uuid();
const identity=z.object({owner:z.string().min(1).max(160),username:z.string().max(100)});
type Row={id:string;name:string;longitude:number;latitude:number;capturedAt:string|null;capturedOffset:string|null;createdAt:number;expiresAt:number|null;shareId?:string|null;eventName?:string;tags?:string;username?:string;image:Uint8Array};
/**
 * `legacyKey` (TOOLBOX_SERVICE_KEY) keeps working as a key for `defaultAppId` with every scope; keys created with
 * `npm run key:create` are looked up in api_keys. Every row belongs to the calling key's app and no app sees another's.
 */
export function createService(path:string,legacyKey='',{defaultAppId='default'}:{defaultAppId?:string}={}){
 if(legacyKey&&legacyKey.length<32)throw new Error('TOOLBOX_SERVICE_KEY must contain at least 32 characters');
 // Checked before migrating, so a misconfigured start never stamps existing rows with the wrong app.
 if(!legacyKey&&!activeKeyCount(path))throw new Error('No API key: set TOOLBOX_SERVICE_KEY or run npm run key:create');
 const db=openDatabase(path,defaultAppId);
 const legacy=Buffer.from(legacyKey);
 function authenticate(header:string|null):Caller|undefined{
  const token=/^Bearer (\S+)$/.exec(header??'')?.[1];if(!token)return undefined;
  const supplied=Buffer.from(token);
  if(legacy.length&&supplied.length===legacy.length&&timingSafeEqual(supplied,legacy))return {appId:defaultAppId,scopes:SCOPES,keyId:'env'};
  return resolveKey(db,token);
 }
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 function transaction<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}
 const audit=(app:string,owner:string,action:string,resourceId:string)=>db.prepare('INSERT INTO audit(id,owner,action,resourceId,createdAt,appId) VALUES(?,?,?,?,?,?)').run(randomUUID(),owner,action,resourceId,Date.now(),app);
 const meta=(p:Row)=>({id:p.id,name:p.name,longitude:p.longitude,latitude:p.latitude,capturedAt:p.capturedAt,capturedOffset:p.capturedOffset,createdAt:p.createdAt,expiresAt:p.expiresAt,url:`/api/photo-shares/${p.shareId}/photos/${p.id}`,shareUrl:p.shareId?`/share/${p.shareId}`:undefined,...(p.tags?{tags:JSON.parse(p.tags),eventName:p.eventName,username:p.username}:{})});
 const columns='p.id,p.name,p.longitude,p.latitude,p.capturedAt,p.capturedOffset,p.createdAt,p.expiresAt,p.shareId';
 return {close:()=>db.close(),async handle(request:Request):Promise<Response>{try{
 const caller=authenticate(request.headers.get('authorization'));
 if(!caller)return json({error:'Unauthorized'},401);
 const app=caller.appId,denied=(scope:Scope)=>caller.scopes.includes(scope)?undefined:json({error:'Forbidden'},403);
 const url=new URL(request.url),path=url.pathname;
 const who=()=>identity.parse({owner:request.headers.get('x-toolbox-owner'),username:decodeURIComponent(request.headers.get('x-toolbox-username')??'')});
 if(path==='/health'&&request.method==='GET')return json({status:'ok'});
 if(path==='/drawing-shares'&&request.method==='POST'){
 const forbidden=denied('write');if(forbidden)return forbidden;
 const {owner,username}=who();
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'ต้องส่ง JSON'},400);
 const body=await request.text();if(Buffer.byteLength(body)>1024*1024)return json({error:'ข้อมูลเกิน 1 MB'},413);
 const data=drawingShareSchema.parse(JSON.parse(body));
 const result=transaction(()=>{
 const shareId=randomUUID();db.prepare('INSERT INTO drawing_shares(id,owner,username,name,createdAt,appId) VALUES(?,?,?,?,?,?)').run(shareId,owner,username,data.name,Date.now(),app);
 for(const d of data.drawings){const drawingId=randomUUID();const inserted=db.prepare('INSERT INTO drawings VALUES(?,?,?)').run(drawingId,shareId,JSON.stringify({...d,id:drawingId}));
 const xs=d.points.map(p=>p[0]),ys=d.points.map(p=>p[1]);
 db.prepare('INSERT INTO drawing_bounds VALUES(?,?,?,?,?)').run(inserted.lastInsertRowid,Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys));}
 audit(app,owner,'DRAWING_SHARE_PUBLISHED',shareId);return {id:shareId,count:data.drawings.length};});return json(result,201);
 }
 if(path==='/data-file-shares'&&request.method==='POST'){
 const forbidden=denied('write');if(forbidden)return forbidden;
 const {owner,username}=who();
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'ต้องส่ง JSON'},400);
 const body=await request.text();if(Buffer.byteLength(body)>MAX_DATA_SHARE_BYTES)return json({error:'ข้อมูลเกิน 5 MB'},413);
 const share=dataFileShareSchema.parse(JSON.parse(body));
 const result=transaction(()=>{
 const shareId=randomUUID(),tags=[automaticShareTag(),...new Set(share.tags)];
 db.prepare('INSERT INTO data_file_shares(id,appId,owner,username,name,description,tags,featureCount,createdAt) VALUES(?,?,?,?,?,?,?,?,?)').run(shareId,app,owner,username,share.name,share.description,JSON.stringify(tags),share.data.features.length,Date.now());
 for(const feature of share.data.features){
  const inserted=db.prepare('INSERT INTO data_features(shareId,data) VALUES(?,?)').run(shareId,JSON.stringify(feature));
  const points=positions(feature.geometry.coordinates),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  db.prepare('INSERT INTO data_feature_bounds VALUES(?,?,?,?,?)').run(inserted.lastInsertRowid,Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys));
 }
 audit(app,owner,'DATA_FILE_SHARE_PUBLISHED',shareId);return {id:shareId,count:share.data.features.length,tags};});return json(result,201);
 }
 if(path==='/public/data-files'&&request.method==='GET'){
 const forbidden=denied('read');if(forbidden)return forbidden;
 const q=publicDataFileQuery.parse(Object.fromEntries(url.searchParams));const [w,s,e,n]=q.bbox;
 const args:(string|number)[]=[app,s,n,w,e];const filters:string[]=[];
 if(q.search){filters.push('(instr(lower(sh.name),lower(?))>0 OR instr(lower(sh.description),lower(?))>0 OR instr(lower(sh.username),lower(?))>0)');args.push(q.search,q.search,q.search);}
 if(q.tag){filters.push('EXISTS (SELECT 1 FROM json_each(sh.tags) WHERE value=?)');args.push(q.tag);}
 args.push(q.limit+1);
 const rows=db.prepare(`SELECT f.data,sh.id AS shareId,sh.name,sh.description,sh.tags,sh.username FROM data_feature_bounds b JOIN data_features f ON f.id=b.featureId JOIN data_file_shares sh ON sh.id=f.shareId WHERE sh.appId=? AND b.maxY>=? AND b.minY<=? AND (b.maxX>=? ${w<e?'AND':'OR'} b.minX<=?) ${filters.map(filter=>`AND ${filter}`).join(' ')} ORDER BY f.id DESC LIMIT ?`).all(...args) as {data:string;shareId:string;name:string;description:string;tags:string;username:string}[];
 // Bounded by count, coordinates and bytes so one viewport never returns a whole dataset.
 const features=[];let points=0,bytes=0;
 for(const row of rows.slice(0,q.limit)){
  const feature=JSON.parse(row.data);points+=positions(feature.geometry.coordinates).length;bytes+=Buffer.byteLength(row.data);if(points>100000||bytes>4*1024*1024)break;
  features.push({...feature,properties:{...feature.properties,share_name:row.name,share_description:row.description,share_tags:JSON.parse(row.tags).join(', '),share_username:row.username,share_id:row.shareId}});
 }
 return json({features,hasMore:rows.length>features.length});
 }
 if(path==='/public/drawings'&&request.method==='GET'){
 const forbidden=denied('read');if(forbidden)return forbidden;
 const q=publicPhotoQuery.parse(Object.fromEntries(url.searchParams));const [w,s,e,n]=q.bbox;const limit=Math.min(q.limit,50);
 const rows=db.prepare(`SELECT d.data,s.name,s.username,s.id AS shareId FROM drawing_bounds b JOIN drawings d ON d.rowid=b.rowId JOIN drawing_shares s ON s.id=d.shareId WHERE s.appId=? AND b.maxY>=? AND b.minY<=? AND (b.maxX>=? ${w<e?'AND':'OR'} b.minX<=?) ORDER BY d.rowid DESC LIMIT ?`).all(app,s,n,w,e,limit+1) as {data:string;name:string;username:string;shareId:string}[];
 const drawings=[];let points=0,bytes=0;
 for(const row of rows.slice(0,limit)){const drawing=JSON.parse(row.data);points+=drawing.points.length;bytes+=Buffer.byteLength(row.data);if(points>20000||bytes>900000)break;drawings.push({...drawing,shareName:row.name,username:row.username,shareId:row.shareId});}
 return json({drawings,hasMore:rows.length>drawings.length});
 }
 if(path==='/shares'&&request.method==='POST'){
 const forbidden=denied('write');if(forbidden)return forbidden;
 const {owner,username}=who();
 const form=await boundedFormData(request);
 const fields=shareFields.parse({eventName:form.get('eventName'),tags:JSON.parse(String(form.get('tags')??'[]'))});
 const files=form.getAll('photos');
 if(!files.length||files.length>10||files.some(file=>!(file instanceof File)))throw new PhotoUploadError('เลือกภาพ 1–10 รูป');
 const photos:Awaited<ReturnType<typeof prepareSharedPhoto>>[]=[];
 for(const [index,file] of (files as File[]).entries())photos.push(await prepareSharedPhoto(file,index));
 const result=transaction(()=>{
 const shareId=randomUUID(),tags=[automaticShareTag(),...new Set(fields.tags)];
 db.prepare('INSERT INTO shares(id,owner,username,eventName,tags,createdAt,appId) VALUES(?,?,?,?,?,?,?)').run(shareId,owner,username,fields.eventName,JSON.stringify(tags),Date.now(),app);
 for(const p of photos)db.prepare('INSERT INTO photos VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),owner,p.name,p.longitude,p.latitude,p.capturedAt,p.capturedOffset,Date.now(),null,shareId,p.image);
 audit(app,owner,'PHOTO_SHARE_PUBLISHED',shareId);return {id:shareId,tags,url:`/share/${shareId}`};});return json(result,201);
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
 const shareMatch=path.match(/^\/(shares|drawing-shares|data-file-shares)\/([^/]+)$/);
 if(shareMatch&&request.method==='DELETE'){
 const kind=shareMatch[1] as 'shares'|'drawing-shares'|'data-file-shares',shareId=id.parse(shareMatch[2]);
 const forbidden=denied('write')&&denied('moderate');if(forbidden)return forbidden;
 const table={'shares':'shares','drawing-shares':'drawing_shares','data-file-shares':'data_file_shares'}[kind];
 const share=db.prepare(`SELECT owner FROM ${table} WHERE id=? AND appId=?`).get(shareId,app) as {owner:string}|undefined;
 if(!share)return json({error:'ไม่พบข้อมูล'},404);
 // Moderators remove any share of their app; writers only their own (owner from the gateway).
 const moderator=caller.scopes.includes('moderate'),actor=moderator?request.headers.get('x-toolbox-owner')||`key:${caller.keyId}`:who().owner;
 if(!moderator&&(denied('write')||actor!==share.owner))return json({error:'Forbidden'},403);
 transaction(()=>{
  if(kind==='shares'){db.prepare('DELETE FROM photos WHERE shareId=?').run(shareId);db.prepare('DELETE FROM shares WHERE id=?').run(shareId);}
  else if(kind==='data-file-shares'){db.prepare('DELETE FROM data_feature_bounds WHERE featureId IN (SELECT id FROM data_features WHERE shareId=?)').run(shareId);db.prepare('DELETE FROM data_features WHERE shareId=?').run(shareId);db.prepare('DELETE FROM data_file_shares WHERE id=?').run(shareId);}
  else{db.prepare('DELETE FROM drawing_bounds WHERE rowId IN (SELECT rowid FROM drawings WHERE shareId=?)').run(shareId);db.prepare('DELETE FROM drawings WHERE shareId=?').run(shareId);db.prepare('DELETE FROM drawing_shares WHERE id=?').run(shareId);}
  audit(app,actor,`${{'shares':'PHOTO','drawing-shares':'DRAWING','data-file-shares':'DATA_FILE'}[kind]}_SHARE_${actor===share.owner?'DELETED':'MODERATED'}`,shareId);
 });
 return json({id:shareId,deleted:true});
 }
 if(shareMatch&&shareMatch[1]==='shares'&&request.method==='GET'){const forbidden=denied('read');if(forbidden)return forbidden;const shareId=id.parse(shareMatch[2]);const share=db.prepare('SELECT eventName,tags FROM shares WHERE id=? AND appId=?').get(shareId,app) as {eventName:string;tags:string}|undefined;if(!share)return json({error:'ไม่พบข้อมูล'},404);return json({...share,tags:JSON.parse(share.tags),photos:(db.prepare(`SELECT ${columns} FROM photos p WHERE shareId=? ORDER BY createdAt,id LIMIT 10`).all(shareId) as Row[]).map(meta)});}
 const publicMatch=path.match(/^\/shares\/([^/]+)\/photos\/([^/]+)$/);
 if(publicMatch&&request.method==='GET'){
 const forbidden=denied('read');if(forbidden)return forbidden;
 const photo=db.prepare('SELECT p.image FROM photos p JOIN shares s ON s.id=p.shareId WHERE p.id=? AND p.shareId=? AND s.appId=?').get(id.parse(publicMatch[2]),id.parse(publicMatch[1]),app);
 if(!photo)return json({error:'ไม่พบภาพ'},404);
 return new Response(new Uint8Array(photo.image as Uint8Array),{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
 return json({error:'Not found'},404);
 }catch(error){if(error instanceof PhotoUploadError)return json({error:error.message},error.status);if(error instanceof z.ZodError||error instanceof SyntaxError||error instanceof URIError)return json({error:'ข้อมูลคำขอไม่ถูกต้อง'},400);console.error('Toolbox request failed',error instanceof Error?error.name:'Unknown');return json({error:'บริการภาพไม่พร้อมใช้งาน'},503);}}};
}
