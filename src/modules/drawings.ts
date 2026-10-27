import {randomUUID} from 'node:crypto';
import {drawingShareSchema} from '../drawing-contract.js';
import {publicPhotoQuery} from '../public-photo-query.js';
import {publicDrawingSetQuery} from '../public-drawing-sets.js';
import {automaticShareTag,publishedRange} from '../share-tags.js';
import {deleteShare,id,type ToolModule} from './context.js';

/** Public drawing sets: POST /drawing-shares, GET /public/drawing-shares, GET|DELETE /drawing-shares/:id, GET /public/drawings. */
export const drawings:ToolModule={name:'drawings',
 migrations:[
  // v1: the tables as a 1.4 database (user_version 4) has them.
  db=>db.exec(`CREATE TABLE drawing_shares(id TEXT PRIMARY KEY,owner TEXT NOT NULL,username TEXT NOT NULL,name TEXT NOT NULL,createdAt INTEGER NOT NULL,appId TEXT NOT NULL DEFAULT '',appName TEXT NOT NULL DEFAULT '');
  CREATE TABLE drawings(id TEXT PRIMARY KEY,shareId TEXT NOT NULL REFERENCES drawing_shares(id),data TEXT NOT NULL);
  CREATE TABLE drawing_bounds(rowId INTEGER PRIMARY KEY,minX REAL NOT NULL,maxX REAL NOT NULL,minY REAL NOT NULL,maxY REAL NOT NULL);
  CREATE INDEX drawing_bounds_lat ON drawing_bounds(maxY,minY);
  CREATE INDEX drawing_bounds_lon ON drawing_bounds(maxX,minX);
  CREATE INDEX drawing_shares_app ON drawing_shares(appId);`),
  // v2: tags on drawing sets (older sets have none) and newest-first set search.
  db=>db.exec(`ALTER TABLE drawing_shares ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
  CREATE INDEX drawing_shares_app_created ON drawing_shares(appId,createdAt);`),
 ],
 async handle(context){
 const {db,request,url,path,app,json,denied,who,transaction,audit}=context;
 if(path==='/drawing-shares'&&request.method==='POST'){
 const forbidden=denied('write');if(forbidden)return forbidden;
 const {owner,username,appName}=who();
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'ต้องส่ง JSON'},400);
 const body=await request.text();if(Buffer.byteLength(body)>1024*1024)return json({error:'ข้อมูลเกิน 1 MB'},413);
 const data=drawingShareSchema.parse(JSON.parse(body));
 const result=transaction(()=>{
 const shareId=randomUUID(),tags=[automaticShareTag(),...new Set(data.tags)];
 db.prepare('INSERT INTO drawing_shares(id,owner,username,name,tags,createdAt,appId,appName) VALUES(?,?,?,?,?,?,?,?)').run(shareId,owner,username,data.name,JSON.stringify(tags),Date.now(),app,appName);
 for(const d of data.drawings){const drawingId=randomUUID();const inserted=db.prepare('INSERT INTO drawings VALUES(?,?,?)').run(drawingId,shareId,JSON.stringify({...d,id:drawingId}));
 const xs=d.points.map(p=>p[0]),ys=d.points.map(p=>p[1]);
 db.prepare('INSERT INTO drawing_bounds VALUES(?,?,?,?,?)').run(inserted.lastInsertRowid,Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys));}
 audit(owner,'DRAWING_SHARE_PUBLISHED',shareId);return {id:shareId,count:data.drawings.length,tags,appName,username};});return json(result,201);
 }
 if(path==='/public/drawing-shares'&&request.method==='GET'){
 const forbidden=denied('read');if(forbidden)return forbidden;
 const q=publicDrawingSetQuery.parse(Object.fromEntries(url.searchParams));
 const args:(string|number)[]=[app];const filters:string[]=[];
 if(q.name){filters.push('instr(lower(s.name),lower(?))>0');args.push(q.name);}
 if(q.username){filters.push('instr(lower(s.username),lower(?))>0');args.push(q.username);}
 if(q.tag){filters.push('EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value=?)');args.push(q.tag);}
 if(q.startDate||q.endDate){filters.push('s.createdAt BETWEEN ? AND ?');args.push(...publishedRange(q.startDate,q.endDate));}
 args.push(q.limit+1,q.offset);
 const rows=db.prepare(`SELECT s.id,s.name,s.tags,s.username,s.appName,s.createdAt,count(d.id) AS drawingCount,min(b.minX) AS west,min(b.minY) AS south,max(b.maxX) AS east,max(b.maxY) AS north FROM drawing_shares s JOIN drawings d ON d.shareId=s.id JOIN drawing_bounds b ON b.rowId=d.rowid WHERE s.appId=? ${filters.map(filter=>`AND ${filter}`).join(' ')} GROUP BY s.id ORDER BY s.createdAt DESC,s.id DESC LIMIT ? OFFSET ?`).all(...args) as {id:string;name:string;tags:string;username:string;appName:string;createdAt:number;drawingCount:number;west:number;south:number;east:number;north:number}[];
 return json({sets:rows.slice(0,q.limit).map(row=>({id:row.id,name:row.name,tags:JSON.parse(row.tags),username:row.username,appName:row.appName,createdAt:row.createdAt,drawingCount:row.drawingCount,bbox:[row.west,row.south,row.east,row.north]})),hasMore:rows.length>q.limit});
 }
 if(path==='/public/drawings'&&request.method==='GET'){
 const forbidden=denied('read');if(forbidden)return forbidden;
 const q=publicPhotoQuery.parse(Object.fromEntries(url.searchParams));const [w,s,e,n]=q.bbox;const limit=Math.min(q.limit,50);
 const rows=db.prepare(`SELECT d.data,s.name,s.username,s.id AS shareId FROM drawing_bounds b JOIN drawings d ON d.rowid=b.rowId JOIN drawing_shares s ON s.id=d.shareId WHERE s.appId=? AND b.maxY>=? AND b.minY<=? AND (b.maxX>=? ${w<e?'AND':'OR'} b.minX<=?) ORDER BY d.rowid DESC LIMIT ?`).all(app,s,n,w,e,limit+1) as {data:string;name:string;username:string;shareId:string}[];
 const drawings=[];let points=0,bytes=0;
 for(const row of rows.slice(0,limit)){const drawing=JSON.parse(row.data);points+=drawing.points.length;bytes+=Buffer.byteLength(row.data);if(points>20000||bytes>900000)break;drawings.push({...drawing,shareName:row.name,username:row.username,shareId:row.shareId});}
 return json({drawings,hasMore:rows.length>drawings.length});
 }
 const shareMatch=path.match(/^\/drawing-shares\/([^/]+)$/);
 if(shareMatch&&request.method==='DELETE')return deleteShare(context,shareMatch[1],{table:'drawing_shares',label:'DRAWING',remove:shareId=>{db.prepare('DELETE FROM drawing_bounds WHERE rowId IN (SELECT rowid FROM drawings WHERE shareId=?)').run(shareId);db.prepare('DELETE FROM drawings WHERE shareId=?').run(shareId);db.prepare('DELETE FROM drawing_shares WHERE id=?').run(shareId);}});
 if(shareMatch&&request.method==='GET'){
 const forbidden=denied('read');if(forbidden)return forbidden;
 const shareId=id.parse(shareMatch[1]);
 const share=db.prepare('SELECT id,name,tags,username,appName,createdAt FROM drawing_shares WHERE id=? AND appId=?').get(shareId,app) as {id:string;name:string;tags:string;username:string;appName:string;createdAt:number}|undefined;
 if(!share)return json({error:'ไม่พบข้อมูล'},404);
 const drawings=(db.prepare('SELECT data FROM drawings WHERE shareId=? ORDER BY rowid LIMIT 100').all(shareId) as {data:string}[]).map(row=>JSON.parse(row.data));
 return json({...share,tags:JSON.parse(share.tags),drawings});
 }
 return undefined;
 }};
