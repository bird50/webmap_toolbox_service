import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import type {Migrations} from '../database.js';
import type {Caller,Scope} from '../api-keys.js';

/** Tool modules a service instance can serve (TOOLBOX_MODULES). */
export const MODULE_NAMES=['photos','drawings','data-files'] as const;
export type ModuleName=typeof MODULE_NAMES[number];

/** What the core gives a module for one authenticated request; every query must filter by `app`. */
export type Context={
 db:DatabaseSync;request:Request;url:URL;path:string;caller:Caller;app:string;
 json:(value:unknown,status?:number)=>Response;
 /** A 403 response when the caller's key lacks `scope`. */
 denied:(scope:Scope)=>Response|undefined;
 /** Gateway identity; throws (400) without `X-Toolbox-Owner`. */
 who:()=>{owner:string;username:string;appName:string};
 transaction:<T>(fn:()=>T)=>T;
 audit:(owner:string,action:string,resourceId:string)=>void;
};
/** One tool's tables and routes. `handle` returns undefined for a request it does not route. */
export type ToolModule={name:ModuleName;migrations:Migrations;handle(context:Context):Response|undefined|Promise<Response|undefined>};

export const id=z.string().uuid();

/** DELETE /<kind>/:id — writers remove their own shares (owner from the gateway), moderators any share of their app. */
export function deleteShare({db,request,caller,app,json,denied,who,transaction,audit}:Context,rawId:string,{table,label,remove}:{table:string;label:string;remove:(shareId:string)=>void}){
 const shareId=id.parse(rawId);
 const forbidden=denied('write')&&denied('moderate');if(forbidden)return forbidden;
 const share=db.prepare(`SELECT owner FROM ${table} WHERE id=? AND appId=?`).get(shareId,app) as {owner:string}|undefined;
 if(!share)return json({error:'ไม่พบข้อมูล'},404);
 const moderator=caller.scopes.includes('moderate'),actor=moderator?request.headers.get('x-toolbox-owner')||`key:${caller.keyId}`:who().owner;
 if(!moderator&&(denied('write')||actor!==share.owner))return json({error:'Forbidden'},403);
 transaction(()=>{remove(shareId);audit(actor,`${label}_SHARE_${actor===share.owner?'DELETED':'MODERATED'}`,shareId);});
 return json({id:shareId,deleted:true});
}
