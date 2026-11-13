import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

export class ChatError extends Error {
  constructor(status,message) { super(message); this.status=status; }
}
const blocked=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(address,prefix,'ipv4');
const globalV6=new BlockList(); globalV6.addSubnet('2000::',3,'ipv6');
for(const [address,prefix] of [['2001::',32],['2001:db8::',32],['2002::',16]]) blocked.addSubnet(address,prefix,'ipv6');
export function isPublicAddress(address) {
  const family=isIP(address);
  return family===4?!blocked.check(address,'ipv4'):family===6&&globalV6.check(address,'ipv6')&&!blocked.check(address,'ipv6');
}
export function normalizeBaseUrl(value) {
  let url;
  try { url=new URL(value); } catch { throw new ChatError(400,'请填写完整的 HTTPS Base URL'); }
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash) throw new ChatError(400,'Base URL 必须使用 HTTPS，且不能包含账号、查询参数或锚点');
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  if(hostname==='localhost'||hostname.endsWith('.localhost')||hostname.endsWith('.local')||(isIP(hostname)&&!isPublicAddress(hostname))) throw new ChatError(400,'不能使用本机或内网 API 地址');
  return url.href.replace(/\/+$/,'');
}
export async function resolvePublicTarget(value,resolve=lookup) {
  const url=new URL(normalizeBaseUrl(value)),hostname=url.hostname.replace(/^\[|\]$/g,'');
  const records=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await resolve(hostname,{all:true,verbatim:true});
  if(!records.length||records.some(record=>!isPublicAddress(record.address))) throw new ChatError(400,'API 地址必须解析到公网地址');
  return {url,address:records[0]};
}
export function modelRequest(profile,messages) {
  let base=normalizeBaseUrl(profile.baseUrl),path=new URL(base).pathname;
  const suffix=profile.protocol==='claude'?'/messages':'/chat/completions';
  if(!base.endsWith(suffix)) {
    if(path==='/'||path==='') base+='/v1';
    base+=suffix;
  }
  const headers={'content-type':'application/json',accept:'text/event-stream'};
  const body={model:profile.model,messages,stream:true};
  if(profile.protocol==='claude') { headers['x-api-key']=profile.apiKey;headers['anthropic-version']='2023-06-01';body.max_tokens=8192; }
  else headers.authorization=`Bearer ${profile.apiKey}`;
  return {url:base,headers,body};
}

async function openUpstream(spec,signal) {
  const {url,address}=await resolvePublicTarget(spec.url);
  return new Promise((resolve,reject)=>{
    const req=request(url,{method:'POST',headers:spec.headers,signal,agent:false,lookup:(_hostname,options,callback)=>{
      if(options?.all) callback(null,[address]); else callback(null,address.address,address.family);
    }},resolve);
    req.on('error',reject);
    req.setTimeout(60000,()=>req.destroy(new ChatError(504,'模型服务响应超时，请稍后重试')));
    req.end(JSON.stringify(spec.body));
  });
}

export async function* readSse(chunks) {
  const decoder=new TextDecoder();let buffer='';
  for await(const chunk of chunks) {
    buffer+=typeof chunk==='string'?chunk:decoder.decode(chunk,{stream:true});
    let match;
    while((match=/\r?\n\r?\n/.exec(buffer))) {
      const block=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);
      const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
      if(data) yield data;
    }
    if(buffer.length>1024*1024) throw new ChatError(502,'模型响应数据过大');
  }
  buffer+=decoder.decode();
  const remaining=buffer.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
  if(remaining) yield remaining;
}

export async function streamModel(profile,messages,signal,emit,transport=openUpstream) {
  const spec=modelRequest(profile,messages),response=await transport(spec,signal);
  const status=response.statusCode??response.status??200;
  if(status<200||status>=300) {
    // Do not forward upstream bodies: they may contain credentials, prompts or proxy diagnostics.
    response.resume?.();
    const message=status===401||status===403?'API Key 无效或无权使用此模型':status===402?'模型账户余额不足':status===429?'模型服务限流，请稍后重试':`模型服务返回 HTTP ${status}，请检查 Base URL、模型名称和服务状态`;
    throw new ChatError(status===429?429:502,message);
  }
  let completed=false,hasText=false;
  for await(const data of readSse(response)) {
    if(signal.aborted) throw signal.reason??new Error('Aborted');
    if(data==='[DONE]') { completed=true;break; }
    let event;
    try { event=JSON.parse(data); } catch { throw new ChatError(502,'模型返回了无效的流式响应'); }
    if(event.error||event.type==='error') throw new ChatError(502,'模型服务中断，请检查配置或稍后重试');
    if(profile.protocol==='claude') {
      const delta=event.delta;
      if(event.type==='content_block_delta'&&delta?.type==='text_delta'&&typeof delta.text==='string') { hasText=true;await emit({type:'text',text:delta.text}); }
      if(event.type==='content_block_delta'&&delta?.type==='thinking_delta'&&typeof delta.thinking==='string') await emit({type:'reasoning',text:delta.thinking});
      if(event.type==='message_delta'&&delta?.stop_reason==='max_tokens') await emit({type:'warning',message:'回复达到模型输出上限，可继续追问。'});
      if(event.type==='message_stop') completed=true;
    } else {
      const choice=event.choices?.[0],delta=choice?.delta;
      if(typeof delta?.content==='string'&&delta.content) { hasText=true;await emit({type:'text',text:delta.content}); }
      if(typeof delta?.reasoning_content==='string'&&delta.reasoning_content) await emit({type:'reasoning',text:delta.reasoning_content});
      if(choice?.finish_reason==='length') await emit({type:'warning',message:'回复达到模型输出上限，可继续追问。'});
      if(choice?.finish_reason) completed=true;
    }
  }
  if(!completed) throw new ChatError(502,'模型连接提前断开，已保留收到的内容');
  if(!hasText) throw new ChatError(502,'模型没有返回可显示的回复，请检查所选模型');
}
