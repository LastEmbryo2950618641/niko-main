import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import test from 'node:test';
import {deepseekProfile,settingsKey,readSettings,saveProfile,deleteProfile,selectProfile} from '../chat-settings.js';
import {isPublicAddress,normalizeBaseUrl,resolvePublicTarget,modelRequest,readSse,streamModel} from '../server/model-client.mjs';
import {createChatServer} from '../server/chat-server.mjs';

const sse=event=>`data: ${JSON.stringify(event)}\n\n`;
const openaiReply=()=>Readable.from([sse({choices:[{delta:{reasoning_content:'分析'}}]}),sse({choices:[{delta:{content:'你好，世界。'}}]}),sse({choices:[{finish_reason:'stop',delta:{}}]}),'data: [DONE]\n\n']);
const memoryStorage=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};};
const chatBody=(apiKey='sk-test',extra={})=>({profile:{...deepseekProfile,apiKey},messages:[{role:'user',content:'你好'}],...extra});
async function withServer(run,transport){
 const directory=await mkdtemp(join(tmpdir(),'niko-chat-test-'));
 // Passing the former state directory guards against accidentally restoring server storage.
 const server=await createChatServer({stateDirectory:directory,transport});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 function client(){let cookie;return async(path,{method='GET',body,headers={},signal}={})=>{
  const response=await fetch(origin+'/chat-api/'+path,{method,signal,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];return response;
 };}
 try{await run({client,origin,directory});assert.deepEqual(await readdir(directory),[],'Server persisted configuration files');}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
}

test('configuration schema codec retains, switches and removes profiles in its memory adapter',()=>{
 const storage=memoryStorage();let state=readSettings(storage);assert.equal(state.profiles[0].hasApiKey,false);
 state=saveProfile(storage,state,{provider:'deepseek',apiKey:'local-test-key'});
 assert.equal(JSON.parse(storage.getItem(settingsKey)).profiles[0].apiKey,'local-test-key');
 assert.equal(readSettings(storage).profiles[0].hasApiKey,true);assert.equal(readSettings(memoryStorage()).profiles[0].hasApiKey,false);
 state=saveProfile(storage,state,{provider:'deepseek',apiKey:''});assert.equal(state.profiles[0].apiKey,'local-test-key');
 state=saveProfile(storage,state,{provider:'custom',name:'Claude',baseUrl:'https://api.anthropic.com/v1',protocol:'claude',model:'test',apiKey:'local-claude'});
 const custom=state.activeProfileId;assert.notEqual(custom,'deepseek');
 state=selectProfile(storage,state,'deepseek');assert.equal(readSettings(storage).activeProfileId,'deepseek');
 state=deleteProfile(storage,state,custom);assert.equal(state.profiles.length,1);assert(!storage.getItem(settingsKey).includes('local-claude'));
 state=deleteProfile(storage,state,'deepseek');assert.equal(state.profiles[0].hasApiKey,false);assert(!storage.getItem(settingsKey).includes('local-test-key'));
});

test('invalid profiles or a failed serialization adapter preserve the prior configuration',()=>{
 const storage=memoryStorage(),state=readSettings(storage);
 assert.throws(()=>saveProfile(storage,state,{provider:'deepseek',apiKey:'test\nheader'}),/无效字符/);
 assert.throws(()=>saveProfile({setItem(){throw new Error('QuotaExceeded');}},state,{provider:'deepseek',apiKey:'test'}),/无法保存/);
 assert.equal(state.profiles[0].apiKey,'');assert.throws(()=>readSettings({getItem(){throw new Error();}}),/禁止读取/);
 storage.setItem(settingsKey,'broken');assert.throws(()=>readSettings(storage),/无法读取/);
});

test('outbound destinations reject local, private, mapped, metadata and DNS-rebinding targets',async()=>{
 for(const address of ['127.0.0.1','10.0.0.1','172.31.0.1','192.168.1.1','169.254.169.254','100.100.100.200','0.0.0.0','224.0.0.1','::1','fe80::1','fc00::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(isPublicAddress(address),false,address);
 for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(isPublicAddress(address),true,address);
 for(const url of ['http://api.example.com','https://localhost','https://[::1]','https://user:pass@api.example.com','https://api.example.com/?secret=x'])assert.throws(()=>normalizeBaseUrl(url));
 await assert.rejects(resolvePublicTarget('https://gateway.example/v1',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),/公网/);
 assert.equal((await resolvePublicTarget('https://gateway.example/v1',async()=>[{address:'8.8.8.8',family:4}])).address.address,'8.8.8.8');
});

test('OpenAI and Claude adapters produce their own headers, endpoints and request bodies',()=>{
 const messages=[{role:'user',content:'你好'}],apiKey='sk-test';
 const openai=modelRequest({...deepseekProfile,apiKey},messages);assert.equal(openai.url,'https://api.deepseek.com/v1/chat/completions');assert.equal(openai.headers.authorization,'Bearer sk-test');assert.equal(openai.headers['x-api-key'],undefined);assert.equal(openai.body.stream,true);
 const claude=modelRequest({protocol:'claude',baseUrl:'https://api.anthropic.com',model:'test-claude',apiKey},messages);assert.equal(claude.url,'https://api.anthropic.com/v1/messages');assert.equal(claude.headers['x-api-key'],apiKey);assert.equal(claude.headers['anthropic-version'],'2023-06-01');assert.equal(claude.headers.authorization,undefined);assert.equal(claude.body.max_tokens,8192);
 assert.equal(modelRequest({protocol:'openai',baseUrl:'https://gateway.example/v1/chat/completions',model:'test',apiKey},messages).url,'https://gateway.example/v1/chat/completions');
});

test('stream parser preserves Chinese characters across byte boundaries and CRLF events',async()=>{
 const bytes=Buffer.from('data: {"text":"你好🙂"}\r\n\r\ndata: [DONE]\r\n\r\n'),values=[];
 for await(const data of readSse(Readable.from([...bytes].map(value=>Buffer.from([value])))))values.push(data);
 assert.deepEqual(values,['{"text":"你好🙂"}','[DONE]']);
});

test('server never persists keys, rejects obsolete storage endpoints and requires credentials each time',async()=>{
 const captured=[];
 await withServer(async({client})=>{
  const call=client();for(const [path,method]of [['config','GET'],['config','PUT'],['config','DELETE'],['active','POST']])assert.equal((await call(path,{method,...(method==='GET'?{}:{body:{apiKey:'never-save'}})})).status,410);
  const first=await call('chat',{method:'POST',body:chatBody('one-request-key')});assert.match(first.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert(!(await first.text()).includes('one-request-key'));
  assert.equal((await call('chat',{method:'POST',body:{profileId:'deepseek',messages:[{role:'user',content:'test'}]}})).status,400);
  assert.equal((await call('chat',{method:'POST',body:chatBody('')})).status,400);
  const second=await call('chat',{method:'POST',body:chatBody('different-key')});await second.text();
  assert.equal(captured.length,2);assert.equal(captured[0].headers.authorization,'Bearer one-request-key');assert.equal(captured[1].headers.authorization,'Bearer different-key');
 },async spec=>{captured.push(spec);return openaiReply();});
});

test('cross-site calls and private targets are rejected; both protocols stream from request profiles',async()=>{
 const captured=[];
 await withServer(async({client})=>{
  const call=client();assert.equal((await call('chat',{method:'POST',headers:{Origin:'https://evil.example'},body:chatBody()})).status,403);
  const unsafe={id:'unsafe',provider:'custom',name:'unsafe',baseUrl:'https://127.0.0.1',protocol:'openai',model:'test',apiKey:'test'};
  assert.equal((await call('chat',{method:'POST',body:chatBody('test',{profile:unsafe})})).status,400);
  const response=await call('chat',{method:'POST',body:chatBody()});assert.equal(response.status,200);const streamed=await response.text();assert(streamed.includes('你好，世界。'));assert(streamed.includes('"type":"done"'));assert(streamed.includes('"type":"reasoning"'));
  const profile={id:'custom',provider:'custom',name:'Claude',baseUrl:'https://gateway.example/v1',protocol:'claude',model:'test-claude',apiKey:'claude-test-key'};
  const claude=await call('chat',{method:'POST',body:chatBody('test',{profile})});const text=await claude.text();assert(text.includes('Claude 回复'));assert(text.includes('"type":"done"'));
  assert.equal(captured.length,2);assert.equal(captured[1].headers['x-api-key'],'claude-test-key');
 },async spec=>{captured.push(spec);return spec.url.endsWith('/messages')?Readable.from([sse({type:'content_block_delta',delta:{type:'text_delta',text:'Claude 回复'}}),sse({type:'message_stop'})]):openaiReply();});
});

test('upstream failure is reported once without exposing error bodies or retrying',async()=>{
 let calls=0;
 await withServer(async({client})=>{
  const result=await client()('chat',{method:'POST',body:chatBody('private-test-key')});const text=await result.text();assert(text.includes('API Key 无效'));assert(!text.includes('private-test-key'));assert(!text.includes('"type":"done"'));assert.equal(calls,1);
 },async()=>{calls++;const result=Readable.from(['provider echoed private-test-key']);result.statusCode=401;return result;});
});

test('an incomplete stream is an error rather than a successful empty reply',async()=>{
 await assert.rejects(streamModel({...deepseekProfile,apiKey:'test'},[{role:'user',content:'test'}],new AbortController().signal,()=>{},async()=>Readable.from([sse({choices:[{delta:{content:'未完成'}}]})])),/提前断开/);
});

test('user cancellation propagates upstream and releases the session for a new request',async()=>{
 let aborted=false,markStarted;const started=new Promise(resolve=>markStarted=resolve);
 await withServer(async({client})=>{
  const call=client();const invalid=await call('chat',{method:'POST',body:chatBody('')});assert.equal(invalid.status,400);
  const controller=new AbortController(),response=await call('chat',{method:'POST',signal:controller.signal,body:chatBody()});const reading=response.text().catch(()=>{});await started;
  assert.equal((await call('chat',{method:'POST',body:chatBody()})).status,409);controller.abort();await reading;
  for(let i=0;i<20&&!aborted;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(aborted,true);
 },async(_spec,signal)=>Readable.from((async function*(){markStarted();yield sse({choices:[{delta:{content:'开始'}}]});await new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true}));})()));
});
