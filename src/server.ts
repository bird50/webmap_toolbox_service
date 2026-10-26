import {createServer} from 'node:http';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createService} from './service.js';
import {MAX_DATA_SHARE_BYTES} from './data-file-share.js';
const bodyLimit=(path?:string)=>path==='/drawing-shares'?1024*1024:path==='/data-file-shares'?MAX_DATA_SHARE_BYTES:25*1024*1024;
const path=resolve(process.env.SQLITE_PATH??'./data/toolbox.sqlite');mkdirSync(dirname(path),{recursive:true});
const service=createService(path,process.env.TOOLBOX_SERVICE_KEY??'',{defaultAppId:process.env.TOOLBOX_DEFAULT_APP_ID||'default'});
const server=createServer(async(req,res)=>{
 try{
 const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>bodyLimit(req.url?.split("?")[0])){res.writeHead(413);res.end();return;}chunks.push(chunk);}
 const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(value)headers.set(name,Array.isArray(value)?value.join(','):value);
 const response=await service.handle(new Request(`http://localhost${req.url}`,{method:req.method,headers,...(req.method!=='GET'&&req.method!=='HEAD'?{body:Buffer.concat(chunks)}:{})}));
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(400);res.end();}
});
server.requestTimeout=30_000;server.listen(Number(process.env.PORT??4010),process.env.HOST??'127.0.0.1',()=>console.log('Toolbox service listening'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{service.close();process.exit(0);}));
