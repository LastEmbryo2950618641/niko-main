import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeProfile } from '../chat-settings.js';
import { ChatError, normalizeBaseUrl, streamModel } from './model-client.mjs';
import {exploreSite} from './site-explorer.mjs';

const maxBody=256*1024,cookieName='niko_chat_session';
function text(value,max,label) { if(typeof value!=='string'||!value.trim()||value.length>max) throw new ChatError(400,`请填写有效的${label}`);return value.trim(); }
async function bodyJson(req) {
  if(!(req.headers['content-type']??'').startsWith('application/json')) throw new ChatError(415,'请求必须使用 JSON');
  let length=0;const chunks=[];
  for await(const chunk of req) { length+=chunk.length;if(length>maxBody) throw new ChatError(413,'消息内容过长，请新建对话');chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new ChatError(400,'请求 JSON 格式无效'); }
}
function sessionFor(req,res,secure) {
  const session=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const created=session&&/^[a-f0-9]{64}$/.test(session)?session:randomBytes(32).toString('hex');
  res.setHeader('Set-Cookie',`${cookieName}=${created}; Path=/chat-api/; Max-Age=31536000; HttpOnly; SameSite=Strict${secure?'; Secure':''}`);
  return created;
}
export async function createChatServer({publicOrigin,transport,websiteTransport,resolveSite}={}) {
  const active=new Set(),rate=new Map();
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const json=(status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    let controller,timer,session;
    try {
      const origin=publicOrigin??`http://${req.headers.host}`;
      if(req.headers.origin&&req.headers.origin!==origin) throw new ChatError(403,'仅支持从当前网站访问');
      if(req.headers['sec-fetch-site']==='cross-site') throw new ChatError(403,'不允许跨站请求');
      if(req.method!=='GET'&&req.headers.origin!==origin) throw new ChatError(403,'缺少有效的同站来源');
      const path=new URL(req.url,origin).pathname;
      if(path==='/chat-api/health'&&req.method==='GET') return json(200,{ok:true});
      if(['/chat-api/config','/chat-api/active'].includes(path)) throw new ChatError(410,'API 配置已改为仅保存在本机浏览器，请刷新页面后重新填写。');
      if(!['/chat-api/chat','/chat-api/site-preview'].includes(path)) throw new ChatError(404,'接口不存在');
      if(req.method!=='POST')throw new ChatError(405,'请求方法不支持');
      session=sessionFor(req,res,origin.startsWith('https:'));
      // Bound writes per caller; this endpoint never supplies a server-owned API key.
      const remote=req.headers['x-real-ip']??req.socket.remoteAddress;
      const now=Date.now();for(const [key,item] of rate) if(now-item.start>60000) rate.delete(key);
      const quota=rate.get(remote)??{start:now,count:0};quota.count++;rate.set(remote,quota);
      if(quota.count>60) throw new ChatError(429,'操作过于频繁，请稍后重试');
      if(rate.size>10000) throw new ChatError(503,'服务繁忙，请稍后重试');
      const body=await bodyJson(req);
      if(body===null||Array.isArray(body)||typeof body!=='object') throw new ChatError(400,'请求格式无效');
      if(path==='/chat-api/site-preview'){
        let profile;try{profile=normalizeProfile(body.profile);}catch(error){throw new ChatError(400,error.message);}
        profile.baseUrl=normalizeBaseUrl(profile.baseUrl);
        if(active.has(session)||active.size>=16)throw new ChatError(409,'已有 AI 任务正在生成，请先等待完成');
        active.add(session);controller=new AbortController();timer=setTimeout(()=>controller.abort(new ChatError(504,'生成网站预览超时，请稍后重试')),90000);timer.unref();
        res.on('close',()=>controller.abort());
        const preview=await exploreSite(profile,body.url,controller.signal,{transport,websiteTransport,resolve:resolveSite});
        return json(200,preview);
      }
      if(path==='/chat-api/chat'&&req.method==='POST') {
        let profile;
        try {profile=normalizeProfile(body.profile);}catch(error){throw new ChatError(400,error.message);}
        profile.baseUrl=normalizeBaseUrl(profile.baseUrl);
        if(!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>200) throw new ChatError(400,'对话消息过多，请新建对话');
        const messages=body.messages.map(message=>{
          if(!message||!['user','assistant'].includes(message.role)) throw new ChatError(400,'对话角色无效');
          return {role:message.role,content:text(message.content,100000,'消息内容')};
        });
        if(messages[0].role!=='user'||messages.at(-1).role!=='user') throw new ChatError(400,'对话必须以用户消息开始和结束');
        if(active.has(session)||active.size>=16) throw new ChatError(409,'已有回复正在生成，请先停止或等待完成');
        active.add(session);controller=new AbortController();timer=setTimeout(()=>controller.abort(new ChatError(504,'本次回复超过 5 分钟，已停止')),300000);timer.unref();
        res.on('close',()=>controller.abort());
        res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
        const emit=async event=>{if(res.destroyed) return;if(!res.write(`data: ${JSON.stringify(event)}\n\n`)) await once(res,'drain',{signal:controller.signal});};
        try { await streamModel(profile,messages,controller.signal,emit,transport);await emit({type:'done'}); }
        catch(error) { if(!res.destroyed) await emit({type:'error',message:error instanceof ChatError?error.message:'连接模型服务失败，请检查配置或网络后重试'}); }
        res.end();return;
      }
      throw new ChatError(405,'请求方法不支持');
    } catch(error) {
      if(!res.headersSent) json(error instanceof ChatError?error.status:500,{error:error instanceof ChatError?error.message:'配置服务暂时不可用，请稍后重试'});
      else if(!res.destroyed) res.end();
    } finally {if(controller) active.delete(session);if(timer) clearTimeout(timer);}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const server=await createChatServer({publicOrigin:process.env.CHAT_PUBLIC_ORIGIN});
  server.listen(Number(process.env.CHAT_PORT??4181),'127.0.0.1',()=>console.log('Homepage chat service listening on loopback'));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.close();server.closeAllConnections();});
}
