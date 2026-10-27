import {randomUUID} from 'node:crypto';
import {automaticShareTag} from '../photo-share.js';
import {dataFileShareSchema,MAX_DATA_SHARE_BYTES,positions,publicDataFileQuery} from '../data-file-share.js';
import {publicDataFileSetQuery} from '../public-data-file-sets.js';
import {publishedRange} from '../share-tags.js';
import {deleteShare,id,type ToolModule} from './context.js';

/** Public data file sets: POST /data-file-shares, GET /public/data-file-shares, GET|DELETE /data-file-shares/:id, GET /public/data-files. */
export const dataFiles:ToolModule={name:'data-files',
 migrations:[
  // v1: the tables as a 1.4 database (user_version 4) has them; one row per feature with numeric bounds for viewport queries.
  db=>db.exec(`CREATE TABLE data_file_shares(id TEXT PRIMARY KEY,appId TEXT NOT NULL,owner TEXT NOT NULL,username TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,tags TEXT NOT NULL,featureCount INTEGER NOT NULL,createdAt INTEGER NOT NULL,appName TEXT NOT NULL DEFAULT '');
  CREATE INDEX data_file_shares_app ON data_file_shares(appId,createdAt);
  CREATE TABLE data_features(id INTEGER PRIMARY KEY,shareId TEXT NOT NULL REFERENCES data_file_shares(id),data TEXT NOT NULL);
  CREATE INDEX data_features_share ON data_features(shareId);
  CREATE TABLE data_feature_bounds(featureId INTEGER PRIMARY KEY REFERENCES data_features(id),minX REAL NOT NULL,maxX REAL NOT NULL,minY REAL NOT NULL,maxY REAL NOT NULL);
  CREATE INDEX data_feature_bounds_lat ON data_feature_bounds(maxY,minY);
  CREATE INDEX data_feature_bounds_lon ON data_feature_bounds(maxX,minX);`),
 ],
 async handle(context){
 const {db,request,url,path,app,json,denied,who,transaction,audit}=context;
 if(path==='/data-file-shares'&&request.method==='POST'){
 const forbidden=denied('write');if(forbidden)return forbidden;
 const {owner,username,appName}=who();
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'ต้องส่ง JSON'},400);
 const body=await request.text();if(Buffer.byteLength(body)>MAX_DATA_SHARE_BYTES)return json({error:'ข้อมูลเกิน 5 MB'},413);
 const share=dataFileShareSchema.parse(JSON.parse(body));
 const result=transaction(()=>{
 const shareId=randomUUID(),tags=[automaticShareTag(),...new Set(share.tags)];
 db.prepare('INSERT INTO data_file_shares(id,appId,appName,owner,username,name,description,tags,featureCount,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)').run(shareId,app,appName,owner,username,share.name,share.description,JSON.stringify(tags),share.data.features.length,Date.now());
 for(const feature of share.data.features){
  const inserted=db.prepare('INSERT INTO data_features(shareId,data) VALUES(?,?)').run(shareId,JSON.stringify(feature));
  const points=positions(feature.geometry.coordinates),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  db.prepare('INSERT INTO data_feature_bounds VALUES(?,?,?,?,?)').run(inserted.lastInsertRowid,Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys));
 }
 audit(owner,'DATA_FILE_SHARE_PUBLISHED',shareId);return {id:shareId,count:share.data.features.length,tags,appName,username};});return json(result,201);
 }
 if(path==='/public/data-file-shares'&&request.method==='GET'){
 const forbidden=denied('read');if(forbidden)return forbidden;
 const q=publicDataFileSetQuery.parse(Object.fromEntries(url.searchParams));
 const args:(string|number)[]=[app];const filters:string[]=[];
 if(q.name){filters.push('instr(lower(s.name),lower(?))>0');args.push(q.name);}
 if(q.username){filters.push('instr(lower(s.username),lower(?))>0');args.push(q.username);}
 if(q.tag){filters.push('EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value=?)');args.push(q.tag);}
 if(q.startDate||q.endDate){filters.push('s.createdAt BETWEEN ? AND ?');args.push(...publishedRange(q.startDate,q.endDate));}
 args.push(q.limit+1,q.offset);
 const rows=db.prepare(`SELECT s.id,s.name,s.description,s.tags,s.username,s.appName,s.createdAt,s.featureCount,min(b.minX) AS west,min(b.minY) AS south,max(b.maxX) AS east,max(b.maxY) AS north FROM data_file_shares s JOIN data_features f ON f.shareId=s.id JOIN data_feature_bounds b ON b.featureId=f.id WHERE s.appId=? ${filters.map(filter=>`AND ${filter}`).join(' ')} GROUP BY s.id ORDER BY s.createdAt DESC,s.id DESC LIMIT ? OFFSET ?`).all(...args) as {id:string;name:string;description:string;tags:string;username:string;appName:string;createdAt:number;featureCount:number;west:number;south:number;east:number;north:number}[];
 return json({sets:rows.slice(0,q.limit).map(row=>({id:row.id,name:row.name,description:row.description,tags:JSON.parse(row.tags),username:row.username,appName:row.appName,createdAt:row.createdAt,featureCount:row.featureCount,bbox:[row.west,row.south,row.east,row.north]})),hasMore:rows.length>q.limit});
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
 const shareMatch=path.match(/^\/data-file-shares\/([^/]+)$/);
 if(shareMatch&&request.method==='DELETE')return deleteShare(context,shareMatch[1],{table:'data_file_shares',label:'DATA_FILE',remove:shareId=>{db.prepare('DELETE FROM data_feature_bounds WHERE featureId IN (SELECT id FROM data_features WHERE shareId=?)').run(shareId);db.prepare('DELETE FROM data_features WHERE shareId=?').run(shareId);db.prepare('DELETE FROM data_file_shares WHERE id=?').run(shareId);}});
 if(shareMatch&&request.method==='GET'){
 const forbidden=denied('read');if(forbidden)return forbidden;
 const shareId=id.parse(shareMatch[1]);
 const share=db.prepare('SELECT id,name,description,tags,username,appName,createdAt FROM data_file_shares WHERE id=? AND appId=?').get(shareId,app) as {id:string;name:string;description:string;tags:string;username:string;appName:string;createdAt:number}|undefined;
 if(!share)return json({error:'ไม่พบข้อมูล'},404);
 // A share holds at most 5,000 features (5 MB), so the whole set is returned for Add to map.
 const features=(db.prepare('SELECT data FROM data_features WHERE shareId=? ORDER BY id').all(shareId) as {data:string}[]).map(row=>JSON.parse(row.data));
 return json({...share,tags:JSON.parse(share.tags),data:{type:'FeatureCollection',features}});
 }
 return undefined;
 }};
