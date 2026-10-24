import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const port=Number(process.env.PORT||4173),host=process.env.HOST||'127.0.0.1';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
http.createServer(async(req,res)=>{
  try{const url=new URL(req.url,'http://localhost'),pathname=decodeURIComponent(url.pathname);const target=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
    if(!target.startsWith(root+path.sep)||pathname.split('/').some(p=>p.startsWith('.')&&p!=='')){res.writeHead(403);res.end('Forbidden');return;}
    const content=await fs.readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(content);
  }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
}).listen(port,host,()=>console.log(`Stock Lab: http://${host}:${port}`));
