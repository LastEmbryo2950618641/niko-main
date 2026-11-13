import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { ChatVault, deepseekProfile, publicSettings } from '../server/chat-vault.mjs';
import { isPublicAddress, normalizeBaseUrl, resolvePublicTarget, modelRequest, readSse, streamModel } from '../server/model-client.mjs';
import { createChatServer } from '../server/chat-server.mjs';

const sse=(event)=>`data: ${JSON.stringify(event)}\n\n`;
const openaiReply=()=>Readable.from([sse({choices:[{delta:{reasoning_content:'分析'}}]}),sse({choices:[{delta:{content:'你好，世界。'}}]}),sse({choices:[{finish_reason:'stop',delta:{}}]}),'data: [DONE]\n\n']);
async function withServer(run,transport) {
  const directory=await mkdtemp(join(tmpdir(),'niko-chat-test-'));
  const server=await createChatServer({stateDirectory:directory,transport});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie;
    return async(path,{method='GET',body,headers={},signal}={})=>{
      const response=await fetch(origin+'/chat-api/'+path,{method,signal,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
      const setCookie=response.headers.get('set-cookie');if(setCookie) cookie=setCookie.split(';')[0];
      return response;
    };
  }
  try {await run({client,origin,directory});} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
}

test('vault encrypts secrets, survives restart and binds ciphertext to its browser session',async()=>{
  const root=await mkdtemp(join(tmpdir(),'niko-vault-'));
  try {
    const vault=new ChatVault(root);await vault.initialize();const session=randomBytes(32).toString('hex'),other=randomBytes(32).toString('hex');
    await vault.update(session,state=>{state.profiles[0].apiKey='sk-test-PRIVATE-credential';});
    assert(!JSON.stringify(publicSettings(await vault.read(session))).includes('sk-test-PRIVATE-credential'));
    for(const file of await readdir(root)) assert(!(await readFile(join(root,file))).includes('sk-test-PRIVATE-credential'));
    const restarted=new ChatVault(root);await restarted.initialize();assert.equal((await restarted.read(session)).profiles[0].apiKey,'sk-test-PRIVATE-credential');
    assert.equal((await restarted.read(other)).profiles[0].apiKey,'');
    await copyFile(vault.filename(session),vault.filename(other));await assert.rejects(vault.read(other));
  } finally {await rm(root,{recursive:true,force:true});}
});

test('outbound destinations reject local, private, mapped, metadata and DNS-rebinding targets',async()=>{
  for(const address of ['127.0.0.1','10.0.0.1','172.31.0.1','192.168.1.1','169.254.169.254','100.100.100.200','0.0.0.0','224.0.0.1','::1','fe80::1','fc00::1','::ffff:127.0.0.1','2001:db8::1']) assert.equal(isPublicAddress(address),false,address);
  for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111']) assert.equal(isPublicAddress(address),true,address);
  for(const url of ['http://api.example.com','https://localhost','https://[::1]','https://user:pass@api.example.com','https://api.example.com/?secret=x']) assert.throws(()=>normalizeBaseUrl(url));
  await assert.rejects(resolvePublicTarget('https://gateway.example/v1',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),/公网/);
  const resolved=await resolvePublicTarget('https://gateway.example/v1',async()=>[{address:'8.8.8.8',family:4}]);assert.equal(resolved.address.address,'8.8.8.8');
});

test('OpenAI and Claude adapters produce their own headers, endpoints and request bodies',()=>{
  const messages=[{role:'user',content:'你好'}],key='sk-test';
  const openai=modelRequest({...deepseekProfile,apiKey:key},messages);assert.equal(openai.url,'https://api.deepseek.com/v1/chat/completions');assert.equal(openai.headers.authorization,'Bearer sk-test');assert.equal(openai.headers['x-api-key'],undefined);assert.equal(openai.body.stream,true);
  const claude=modelRequest({protocol:'claude',baseUrl:'https://api.anthropic.com',model:'test-claude',apiKey:key},messages);assert.equal(claude.url,'https://api.anthropic.com/v1/messages');assert.equal(claude.headers['x-api-key'],key);assert.equal(claude.headers['anthropic-version'],'2023-06-01');assert.equal(claude.headers.authorization,undefined);assert.equal(claude.body.max_tokens,8192);
  assert.equal(modelRequest({protocol:'openai',baseUrl:'https://gateway.example/v1/chat/completions',model:'test',apiKey:key},messages).url,'https://gateway.example/v1/chat/completions');
});

test('stream parser preserves Chinese characters across byte boundaries and CRLF events',async()=>{
  const bytes=Buffer.from('data: {"text":"你好🙂"}\r\n\r\ndata: [DONE]\r\n\r\n');const values=[];
  for await(const data of readSse(Readable.from([...bytes].map(value=>Buffer.from([value]))))) values.push(data);
  assert.deepEqual(values,['{"text":"你好🙂"}','[DONE]']);
});

test('configuration only needs a DeepSeek key, never returns it, and is isolated per browser',async()=>{
  await withServer(async({client,directory})=>{
    const first=client(),second=client();const initial=await first('config');assert.match(initial.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.equal((await initial.json()).profiles[0].hasApiKey,false);
    const saved=await first('config',{method:'PUT',body:{provider:'deepseek',apiKey:'sk-test-not-real'}});assert.equal(saved.status,200);const payload=await saved.text();assert(!payload.includes('sk-test-not-real'));assert(!payload.includes('"apiKey"'));assert(JSON.parse(payload).profiles[0].hasApiKey);
    assert.equal((await (await second('config')).json()).profiles[0].hasApiKey,false);
    const retained=await first('config',{method:'PUT',body:{provider:'deepseek',apiKey:''}});assert.equal((await retained.json()).profiles[0].hasApiKey,true);
    const invalid=await first('config',{method:'PUT',body:{provider:'custom',name:'unsafe',baseUrl:'http://127.0.0.1:80',protocol:'openai',model:'test',apiKey:'test'}});assert.equal(invalid.status,400);
    for(const file of await readdir(directory)) assert(!(await readFile(join(directory,file))).includes('sk-test-not-real'));
  });
});

test('cross-site writes are rejected and both protocols stream through the real HTTP handler',async()=>{
  const captured=[];
  await withServer(async({client})=>{
    const call=client();await call('config');
    assert.equal((await call('config',{method:'PUT',headers:{Origin:'https://evil.example'},body:{provider:'deepseek',apiKey:'do-not-save'}})).status,403);
    assert.equal((await call('chat',{method:'POST',body:{profileId:'deepseek',messages:[{role:'user',content:'你好'}]}})).status,400);
    await call('config',{method:'PUT',body:{provider:'deepseek',apiKey:'sk-test'}});
    const response=await call('chat',{method:'POST',body:{profileId:'deepseek',messages:[{role:'user',content:'你好'}]}});assert.equal(response.status,200);const streamed=await response.text();assert(streamed.includes('你好，世界。'));assert(streamed.includes('"type":"done"'));assert(streamed.includes('"type":"reasoning"'));
    const added=await call('config',{method:'PUT',body:{provider:'custom',name:'Claude 测试',baseUrl:'https://gateway.example/v1',protocol:'claude',model:'test-claude',apiKey:'claude-test-key'}});const data=await added.json();const id=data.activeProfileId;
    const claude=await call('chat',{method:'POST',body:{profileId:id,messages:[{role:'user',content:'你好'}]}});const text=await claude.text();assert(text.includes('Claude 回复'));assert(text.includes('"type":"done"'));
    const removed=await call('config',{method:'DELETE',body:{id}});assert.equal((await removed.json()).profiles.length,1);
    assert.equal(captured.length,2);assert.equal(captured[1].headers['x-api-key'],'claude-test-key');
  },async(spec)=>{captured.push(spec);return spec.url.endsWith('/messages')?Readable.from([sse({type:'content_block_delta',delta:{type:'text_delta',text:'Claude 回复'}}),sse({type:'message_stop'})]):openaiReply();});
});

test('upstream failure is reported once without exposing error bodies or retrying',async()=>{
  let calls=0;
  await withServer(async({client})=>{
    const call=client();await call('config');await call('config',{method:'PUT',body:{provider:'deepseek',apiKey:'private-test-key'}});
    const result=await call('chat',{method:'POST',body:{profileId:'deepseek',messages:[{role:'user',content:'你好'}]}});const text=await result.text();assert(text.includes('API Key 无效'));assert(!text.includes('private-test-key'));assert(!text.includes('"type":"done"'));assert.equal(calls,1);
  },async()=>{calls++;const result=Readable.from(['provider echoed private-test-key']);result.statusCode=401;return result;});
});

test('an incomplete stream is an error rather than a successful empty reply',async()=>{
  await assert.rejects(streamModel({...deepseekProfile,apiKey:'test'},[{role:'user',content:'test'}],new AbortController().signal,()=>{},async()=>Readable.from([sse({choices:[{delta:{content:'未完成'}}]})])),/提前断开/);
});

test('user cancellation propagates upstream and releases the session for a new request',async()=>{
  let aborted=false,markStarted;const started=new Promise(resolve=>markStarted=resolve);
  await withServer(async({client})=>{
    const call=client();await call('config');await call('config',{method:'PUT',body:{provider:'deepseek',apiKey:'test'}});
    const controller=new AbortController();const response=await call('chat',{method:'POST',signal:controller.signal,body:{profileId:'deepseek',messages:[{role:'user',content:'test'}]}});const reading=response.text().catch(()=>{});await started;
    assert.equal((await call('chat',{method:'POST',body:{profileId:'deepseek',messages:[{role:'user',content:'test'}]}})).status,409);
    controller.abort();await reading;
    for(let i=0;i<20&&!aborted;i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(aborted,true);
  },async(_spec,signal)=>Readable.from((async function*(){markStarted();yield sse({choices:[{delta:{content:'开始'}}]});await new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true}));})()));
});
