import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {appId} from './database.js';

/** read: public GETs · write: publish and delete own shares · moderate: delete any share of the app. */
export const SCOPES=['read','write','moderate'] as const;
export type Scope=typeof SCOPES[number];
export type Caller={appId:string;scopes:readonly Scope[];keyId:string};
export type KeyInfo={id:string;appId:string;scopes:Scope[];label:string;createdAt:number;revokedAt:number|null};
const scopes=z.array(z.enum(SCOPES)).min(1).transform(list=>[...new Set(list)]);
const label=z.string().trim().max(100);

// Keys carry 256 random bits, so a plain SHA-256 is enough to store them; only the hash is kept.
const digest=(key:string)=>createHash('sha256').update(key).digest('hex');
const row=(r:Record<string,unknown>):KeyInfo=>({id:String(r.id),appId:String(r.appId),scopes:JSON.parse(String(r.scopes)),label:String(r.label),createdAt:Number(r.createdAt),revokedAt:r.revokedAt===null?null:Number(r.revokedAt)});

/** Creates a key for an app. The returned `key` is shown once and cannot be recovered. */
export function createKey(db:DatabaseSync,input:{appId:string;scopes:readonly string[];label?:string}){
 const app=appId.parse(input.appId),granted=scopes.parse(input.scopes),name=label.parse(input.label??'');
 const id=`key_${randomBytes(6).toString('hex')}`,key=`tbx_${randomBytes(32).toString('base64url')}`;
 db.prepare('INSERT INTO api_keys(id,appId,scopes,hash,label,createdAt,revokedAt) VALUES(?,?,?,?,?,?,NULL)').run(id,app,JSON.stringify(granted),digest(key),name,Date.now());
 return {id,key,appId:app,scopes:granted};
}
export function listKeys(db:DatabaseSync):KeyInfo[]{
 return (db.prepare('SELECT id,appId,scopes,label,createdAt,revokedAt FROM api_keys ORDER BY appId,createdAt').all() as Record<string,unknown>[]).map(row);
}
/** Revocation is immediate: the service looks keys up on every request. */
export function revokeKey(db:DatabaseSync,id:string){
 return db.prepare('UPDATE api_keys SET revokedAt=? WHERE id=? AND revokedAt IS NULL').run(Date.now(),id).changes>0;
}
/** Active keys in the database at `path`, read without creating or migrating anything. */
export function activeKeyCount(path:string){
 if(path!==':memory:'&&!existsSync(path))return 0;
 const db=new DatabaseSync(path,{readOnly:path!==':memory:'});
 try{
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='api_keys'").get())return 0;
  return Number((db.prepare('SELECT count(*) AS n FROM api_keys WHERE revokedAt IS NULL').get() as {n:number}).n);
 }finally{db.close();}
}
export function resolveKey(db:DatabaseSync,key:string):Caller|undefined{
 const found=db.prepare('SELECT id,appId,scopes FROM api_keys WHERE hash=? AND revokedAt IS NULL').get(digest(key)) as {id:string;appId:string;scopes:string}|undefined;
 return found&&{appId:found.appId,scopes:JSON.parse(found.scopes),keyId:found.id};
}
