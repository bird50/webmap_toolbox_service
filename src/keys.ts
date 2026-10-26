import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {z} from 'zod';
import {openDatabase} from './database.js';
import {createKey,listKeys,revokeKey} from './api-keys.js';

// npm run key:create -- --app <id> --scopes read,write [--label "…"] · npm run key:list · npm run key:revoke -- <key id>
const usage='ใช้: key:create -- --app <app-id> --scopes read,write[,moderate] [--label ข้อความ] | key:list | key:revoke -- <key id>';
const {positionals,values}=parseArgs({allowPositionals:true,options:{app:{type:'string'},scopes:{type:'string'},label:{type:'string'}}});
const path=resolve(process.env.SQLITE_PATH??'./data/toolbox.sqlite');mkdirSync(dirname(path),{recursive:true});
const db=openDatabase(path,process.env.TOOLBOX_DEFAULT_APP_ID||'default');
const date=(time:number|null)=>time===null?'-':new Date(time).toISOString().slice(0,16).replace('T',' ');
try{
 const [command,target]=positionals;
 if(command==='create'){
  if(!values.app||!values.scopes)throw new Error(usage);
  const created=createKey(db,{appId:values.app,scopes:values.scopes.split(',').map(scope=>scope.trim()),label:values.label});
  console.log(`สร้าง ${created.id} ให้แอป ${created.appId} (${created.scopes.join(', ')})`);
  console.log(`\n  ${created.key}\n`);
  console.log('คัดลอกไปใส่ TOOLBOX_SERVICE_KEY ฝั่ง server ของแอปนั้น ระบบแสดง key นี้ครั้งเดียวและเก็บไว้เฉพาะ hash');
 }else if(command==='list'){
  const keys=listKeys(db);
  if(!keys.length)console.log('ยังไม่มี key ในตาราง (TOOLBOX_SERVICE_KEY ใน .env ยังใช้ได้กับแอป default)');
  else console.table(keys.map(key=>({id:key.id,app:key.appId,scopes:key.scopes.join(','),label:key.label,'created (UTC)':date(key.createdAt),'revoked (UTC)':date(key.revokedAt)})));
 }else if(command==='revoke'){
  if(!target)throw new Error(usage);
  console.log(revokeKey(db,target)?`ยกเลิก ${target} แล้ว มีผลทันที`:`ไม่พบ key ${target} หรือถูกยกเลิกไปแล้ว`);
 }else throw new Error(usage);
}catch(error){
 console.error(error instanceof z.ZodError?error.issues.map(issue=>issue.message).join('\n'):error instanceof Error?error.message:String(error));
 process.exitCode=1;
}finally{db.close();}
