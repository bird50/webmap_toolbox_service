import {DatabaseSync} from 'node:sqlite';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {boundedFormData,prepareSharedPhoto,PhotoUploadError} from './upload.js';
import {shareFields,automaticShareTag} from './photo-share.js';
import {publicPhotoQuery} from './public-photo-query.js';
import {drawingShareSchema} from './drawing-contract.js';
const id=z.string().uuid();
const identity=z.object({owner:z.string().min(1).max(160),username:z.string().max(100)});
type Row={id:string;name:string;longitude:number;latitude:number;capturedAt:string|null;capturedOffset:string|null;createdAt:number;expiresAt:number|null;shareId?:string|null;eventName?:string;tags?:string;username?:string;image:Uint8Array};
export function createService(path:string,key:string){
 if(key.length<32)throw new Error('TOOLBOX_SERVICE_KEY must contain at least 32 characters');
 const db=new DatabaseSync(path);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS drawing_shares(id TEXT PRIMARY KEY,owner TEXT NOT NULL,username TEXT NOT NULL,name TEXT NOT NULL,createdAt INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS drawings(id TEXT PRIMARY KEY,shareId TEXT NOT NULL REFERENCES drawing_shares(id),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS drawing_bounds(rowId INTEGER PRIMARY KEY,minX REAL NOT NULL,maxX REAL NOT NULL,minY REAL NOT NULL,maxY REAL NOT NULL);
 CREATE INDEX IF NOT EXISTS drawing_bounds_lat ON drawing_bounds(maxY,minY);
 CREATE INDEX IF NOT EXISTS drawing_bounds_lon ON drawing_bounds(maxX,minX);
 CREATE TABLE IF NOT EXISTS shares(id TEXT PRIMARY KEY,owner TEXT NOT NULL,username TEXT NOT NULL,eventName TEXT NOT NULL,tags TEXT NOT NULL,createdAt INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,longitude REAL NOT NULL,latitude REAL NOT NULL,capturedAt TEXT,capturedOffset TEXT,createdAt INTEGER NOT NULL,expiresAt INTEGER,shareId TEXT REFERENCES shares(id),image BLOB NOT NULL);
 CREATE INDEX IF NOT EXISTS photos_owner_expiry ON photos(owner,expiresAt);
 CREATE INDEX IF NOT EXISTS photos_viewport ON photos(latitude,longitude) WHERE shareId IS NOT NULL;
 CREATE INDEX IF NOT EXISTS photos_share ON photos(shareId);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,owner TEXT NOT NULL,action TEXT NOT NULL,resourceId TEXT NOT NULL,createdAt INTEGER NOT NULL);`);
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 function transaction<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}
 const audit=(owner:string,action:string,resourceId:string)=>db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(),owner,action,resourceId,Date.now());
 const meta=(p:Row)=>({id:p.id,name:p.name,longitude:p.longitude,latitude:p.latitude,capturedAt:p.capturedAt,capturedOffset:p.capturedOffset,createdAt:p.createdAt,expiresAt:p.expiresAt,url:`/api/photo-shares/${p.shareId}/photos/${p.id}`,shareUrl:p.shareId?`/share/${p.shareId}`:undefined,...(p.tags?{tags:JSON.parse(p.tags),eventName:p.eventName,username:p.username}:{})});
 const columns='p.id,p.name,p.longitude,p.latitude,p.capturedAt,p.capturedOffset,p.createdAt,p.expiresAt,p.shareId';
 return {close:()=>db.close(),async handle(request:Request):Promise<Response>{try{
 const supplied=Buffer.from(request.headers.get('authorization')??'');const expected=Buffer.from(`Bearer ${key}`);
 if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return json({error:'Unauthorized'},401);
 const url=new URL(request.url),path=url.pathname;
 const who=()=>identity.parse({owner:request.headers.get('x-toolbox-owner'),username:decodeURIComponent(request.headers.get('x-toolbox-username')??'')});
 if(path==='/health'&&request.method==='GET')return json({status:'ok'});
 if(path==='/drawing-shares'&&request.method==='POST'){
 const {owner,username}=who();
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'ต้องส่ง JSON'},400);
 const body=await request.text();if(Buffer.byteLength(body)>1024*1024)return json({error:'ข้อมูลเกิน 1 MB'},413);
 const data=drawingShareSchema.parse(JSON.parse(body));
 const result=transaction(()=>{
 const shareId=randomUUID();db.prepare('INSERT INTO drawing_shares VALUES(?,?,?,?,?)').run(shareId,owner,username,data.name,Date.now());
 for(const d of data.drawings){const drawingId=randomUUID();const inserted=db.prepare('INSERT INTO drawings VALUES(?,?,?)').run(drawingId,shareId,JSON.stringify({...d,id:drawingId}));
 const xs=d.points.map(p=>p[0]),ys=d.points.map(p=>p[1]);
 db.prepare('INSERT INTO drawing_bounds VALUES(?,?,?,?,?)').run(inserted.lastInsertRowid,Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys));}
 audit(owner,'DRAWING_SHARE_PUBLISHED',shareId);return {id:shareId,count:data.drawings.length};});return json(result,201);
 }
 if(path==='/public/drawings'&&request.method==='GET'){
 const q=publicPhotoQuery.parse(Object.fromEntries(url.searchParams));const [w,s,e,n]=q.bbox;const limit=Math.min(q.limit,50);
 const rows=db.prepare(`SELECT d.data,s.name,s.username,s.id AS shareId FROM drawing_bounds b JOIN drawings d ON d.rowid=b.rowId JOIN drawing_shares s ON s.id=d.shareId WHERE b.maxY>=? AND b.minY<=? AND (b.maxX>=? ${w<e?'AND':'OR'} b.minX<=?) ORDER BY d.rowid DESC LIMIT ?`).all(s,n,w,e,limit+1) as {data:string;name:string;username:string;shareId:string}[];
 const drawings=[];let points=0,bytes=0;
 for(const row of rows.slice(0,limit)){const drawing=JSON.parse(row.data);points+=drawing.points.length;bytes+=Buffer.byteLength(row.data);if(points>20000||bytes>900000)break;drawings.push({...drawing,shareName:row.name,username:row.username,shareId:row.shareId});}
 return json({drawings,hasMore:rows.length>drawings.length});
 }
 if(path==='/shares'&&request.method==='POST'){
 const {owner,username}=who();
 const form=await boundedFormData(request);
 const fields=shareFields.parse({eventName:form.get('eventName'),tags:JSON.parse(String(form.get('tags')??'[]'))});
 const files=form.getAll('photos');
 if(!files.length||files.length>10||files.some(file=>!(file instanceof File)))throw new PhotoUploadError('เลือกภาพ 1–10 รูป');
 const photos:Awaited<ReturnType<typeof prepareSharedPhoto>>[]=[];
 for(const [index,file] of (files as File[]).entries())photos.push(await prepareSharedPhoto(file,index));
 const result=transaction(()=>{
 const shareId=randomUUID(),tags=[automaticShareTag(),...new Set(fields.tags)];
 db.prepare('INSERT INTO shares VALUES(?,?,?,?,?,?)').run(shareId,owner,username,fields.eventName,JSON.stringify(tags),Date.now());
 for(const p of photos)db.prepare('INSERT INTO photos VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),owner,p.name,p.longitude,p.latitude,p.capturedAt,p.capturedOffset,Date.now(),null,shareId,p.image);
 audit(owner,'PHOTO_SHARE_PUBLISHED',shareId);return {id:shareId,tags,url:`/share/${shareId}`};});return json(result,201);
 }
 if(path==='/public/photos'&&request.method==='GET'){
 const q=publicPhotoQuery.parse(Object.fromEntries(url.searchParams));const [w,s,e,n]=q.bbox;
 const args:(string|number)[]=[s,n,w,e];const filters:string[]=[];
 if(q.username){filters.push('instr(lower(s.username),lower(?))>0');args.push(q.username);}
 if(q.eventName){filters.push('instr(lower(s.eventName),lower(?))>0');args.push(q.eventName);}
 if(q.tag){filters.push('EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value=?)');args.push(q.tag);}
 if(q.startDate||q.endDate){filters.push('(p.capturedAt>=? AND p.capturedAt<=?)');args.push(q.startDate?`${q.startDate}T00:00:00`:'0000',q.endDate?`${q.endDate}T23:59:59`:'9999');}
 args.push(q.limit+1);
 const rows=db.prepare(`SELECT ${columns},s.eventName,s.tags,s.username FROM photos p JOIN shares s ON s.id=p.shareId WHERE p.latitude BETWEEN ? AND ? AND (p.longitude>=? ${w<e?'AND':'OR'} p.longitude<=?) ${filters.length?`AND (${filters.join(' OR ')})`:''} ORDER BY p.createdAt DESC,p.id DESC LIMIT ?`).all(...args) as Row[];
 return json({photos:rows.slice(0,q.limit).map(meta),hasMore:rows.length>q.limit});
 }
 const shareMatch=path.match(/^\/shares\/([^/]+)$/);
 if(shareMatch&&request.method==='GET'){const shareId=id.parse(shareMatch[1]);const share=db.prepare('SELECT eventName,tags FROM shares WHERE id=?').get(shareId) as {eventName:string;tags:string}|undefined;if(!share)return json({error:'ไม่พบข้อมูล'},404);return json({...share,tags:JSON.parse(share.tags),photos:(db.prepare(`SELECT ${columns} FROM photos p WHERE shareId=? ORDER BY createdAt,id LIMIT 10`).all(shareId) as Row[]).map(meta)});}
 const publicMatch=path.match(/^\/shares\/([^/]+)\/photos\/([^/]+)$/);
 if(publicMatch&&request.method==='GET'){
 const photo=db.prepare('SELECT image FROM photos WHERE id=? AND shareId=?').get(id.parse(publicMatch[2]),id.parse(publicMatch[1]));
 if(!photo)return json({error:'ไม่พบภาพ'},404);
 return new Response(new Uint8Array(photo.image as Uint8Array),{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
 return json({error:'Not found'},404);
 }catch(error){if(error instanceof PhotoUploadError)return json({error:error.message},error.status);if(error instanceof z.ZodError||error instanceof SyntaxError||error instanceof URIError)return json({error:'ข้อมูลคำขอไม่ถูกต้อง'},400);console.error('Toolbox request failed',error instanceof Error?error.name:'Unknown');return json({error:'บริการภาพไม่พร้อมใช้งาน'},503);}}};
}
