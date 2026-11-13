import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createChatServer} from './chat-server.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const publicFiles=new Set(['index.html','chat.js','chat.css','chat-settings.js','browser-settings.js','chat-conversations.js','site-icons.js','site-icons.svg','ornaments.css','select-menu.js','ui-motion.js','motion.css','add-site.js','add-site.css','site-details.js','site-icon-catalog.js','error-dialog.js','site-library.js','recycle-bin.js','recycle-bin.css']);
export async function createDevServer(){
  const chat=await createChatServer();
  const server=createServer(async(req,res)=>{
    let path;try{path=new URL(req.url,'http://localhost').pathname;}catch{res.writeHead(400).end();return;}
    if(path.startsWith('/chat-api/')){chat.emit('request',req,res);return;}
    const file=path==='/'?'index.html':path.slice(1);
    if(!publicFiles.has(file)||!['GET','HEAD'].includes(req.method)){res.writeHead(404).end();return;}
    try{const data=await readFile(resolve(root,file));res.writeHead(200,{'content-type':{'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.svg':'image/svg+xml'}[extname(file)],'cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:data);}
    catch{res.writeHead(404).end();}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const index=process.argv.indexOf('--port'),port=Number(index<0?process.env.PORT??4180:process.argv[index+1]);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid local preview port');
  const server=await createDevServer();server.listen(port,'127.0.0.1',()=>console.log(`Homepage preview: http://127.0.0.1:${port}/`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close();server.closeAllConnections();});
}
