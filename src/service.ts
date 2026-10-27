import {randomUUID, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {PhotoUploadError} from './upload.js';
import {openDatabase} from './database.js';
import {activeKeyCount,resolveKey,SCOPES,type Caller,type Scope} from './api-keys.js';
import {MODULE_NAMES,MODULES,moduleList,type ModuleName} from './modules/index.js';
import type {Context} from './modules/context.js';
/** Who published: the gateway's owner ID (for deletes), the app user's name (`anonymous` when the gateway names none) and the app's display name. */
export const ANONYMOUS='anonymous';
const identity=z.object({owner:z.string().min(1).max(160),username:z.string().trim().max(100).transform(name=>name||ANONYMOUS),appName:z.string().trim().max(100)});
/**
 * `legacyKey` (TOOLBOX_SERVICE_KEY) keeps working as a key for `defaultAppId` with every scope; keys created with
 * `npm run key:create` are looked up in api_keys. Every row belongs to the calling key's app and no app sees another's.
 * Only the tool `modules` listed are served (their tables created, their routes answered); other routes answer 404.
 */
export function createService(path:string,legacyKey='',{defaultAppId='default',modules=MODULE_NAMES}:{defaultAppId?:string;modules?:readonly ModuleName[]}={}){
 if(legacyKey&&legacyKey.length<32)throw new Error('TOOLBOX_SERVICE_KEY must contain at least 32 characters');
 const enabled=moduleList.parse(modules).map(name=>MODULES[name]);
 // Checked before migrating, so a misconfigured start never stamps existing rows with the wrong app.
 if(!legacyKey&&!activeKeyCount(path))throw new Error('No API key: set TOOLBOX_SERVICE_KEY or run npm run key:create');
 const db=openDatabase(path,defaultAppId,enabled);
 const legacy=Buffer.from(legacyKey);
 function authenticate(header:string|null):Caller|undefined{
  const token=/^Bearer (\S+)$/.exec(header??'')?.[1];if(!token)return undefined;
  const supplied=Buffer.from(token);
  if(legacy.length&&supplied.length===legacy.length&&timingSafeEqual(supplied,legacy))return {appId:defaultAppId,scopes:SCOPES,keyId:'env'};
  return resolveKey(db,token);
 }
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 function transaction<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}
 return {close:()=>db.close(),async handle(request:Request):Promise<Response>{try{
 const caller=authenticate(request.headers.get('authorization'));
 if(!caller)return json({error:'Unauthorized'},401);
 const app=caller.appId,denied=(scope:Scope)=>caller.scopes.includes(scope)?undefined:json({error:'Forbidden'},403);
 const url=new URL(request.url),path=url.pathname;
 const header=(name:string)=>decodeURIComponent(request.headers.get(name)??'');
 const who=()=>{const found=identity.parse({owner:request.headers.get('x-toolbox-owner'),username:header('x-toolbox-username'),appName:header('x-toolbox-app-name')});return {...found,appName:found.appName||app};};
 const audit=(owner:string,action:string,resourceId:string)=>{db.prepare('INSERT INTO audit(id,owner,action,resourceId,createdAt,appId) VALUES(?,?,?,?,?,?)').run(randomUUID(),owner,action,resourceId,Date.now(),app);};
 if(path==='/health'&&request.method==='GET')return json({status:'ok'});
 const context:Context={db,request,url,path,caller,app,json,denied,who,transaction,audit};
 for(const module of enabled){const response=await module.handle(context);if(response)return response;}
 return json({error:'Not found'},404);
 }catch(error){if(error instanceof PhotoUploadError)return json({error:error.message},error.status);if(error instanceof z.ZodError||error instanceof SyntaxError||error instanceof URIError)return json({error:'ข้อมูลคำขอไม่ถูกต้อง'},400);console.error('Toolbox request failed',error instanceof Error?error.name:'Unknown');return json({error:'บริการภาพไม่พร้อมใช้งาน'},503);}}};
}
