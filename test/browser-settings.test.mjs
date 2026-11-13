import assert from 'node:assert/strict';
import {webcrypto as crypto} from 'node:crypto';
import test from 'node:test';
import {createBrowserSettings,settingsKey} from '../browser-settings.js';
import {deepseekProfile} from '../chat-settings.js';

function fixture({secureContext=true}={}) {
  const data=new Map();let encryptionKey;
  const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  const keyStore={async get({create=false}={}){if(!encryptionKey&&create)encryptionKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);return encryptionKey;}};
  const options={storage,keyStore,crypto,secureContext};
  return {data,storage,keyStore,options,store:createBrowserSettings(options)};
}
test('browser credentials are encrypted at rest, survive reload and use a non-exportable key',async()=>{
  const f=fixture();let state=await f.store.read();assert.equal(state.profiles[0].hasApiKey,false);
  state=await f.store.save(state,{provider:'deepseek',apiKey:'real-format-secret-test'});
  const raw=f.storage.getItem(settingsKey),saved=JSON.parse(raw);assert.equal(saved.algorithm,'AES-GCM');assert.equal(saved.version,2);assert(!raw.includes('real-format-secret-test'));assert(!raw.includes('apiKey'));
  assert.equal((await f.keyStore.get()).extractable,false);await assert.rejects(crypto.subtle.exportKey('raw',await f.keyStore.get()));
  const reloaded=await createBrowserSettings(f.options).read();assert.equal(reloaded.profiles[0].apiKey,'real-format-secret-test');
  await f.store.save(state,{provider:'deepseek',apiKey:''});assert.notEqual(f.storage.getItem(settingsKey),raw);assert.equal((await f.store.read()).profiles[0].apiKey,'real-format-secret-test');
});
test('legacy credentials migrate locally only after successful encryption',async()=>{
  const f=fixture(),legacy=JSON.stringify({activeProfileId:'deepseek',profiles:[{...deepseekProfile,apiKey:'old-secret'}]});f.storage.setItem(settingsKey,legacy);
  assert.equal((await f.store.read()).profiles[0].apiKey,'old-secret');assert(!f.storage.getItem(settingsKey).includes('old-secret'));
  const blocked=fixture();blocked.storage.setItem(settingsKey,legacy);blocked.storage.setItem=()=>{throw new Error('QuotaExceeded');};
  await assert.rejects(blocked.store.read(),/无法保存/);assert.equal(blocked.storage.getItem(settingsKey),legacy);
});
test('encryption fails closed on HTTP, unavailable keys or altered ciphertext without overwriting data',async()=>{
  const insecure=fixture({secureContext:false});await assert.rejects(insecure.store.save(await insecure.store.read(),{provider:'deepseek',apiKey:'never-plaintext'}),/HTTPS/);assert.equal(insecure.storage.getItem(settingsKey),null);
  const f=fixture();await f.store.save(await f.store.read(),{provider:'deepseek',apiKey:'secret'});const valid=f.storage.getItem(settingsKey);
  const wrong=fixture();wrong.storage.setItem(settingsKey,valid);await assert.rejects(wrong.store.read(),/无法解密/);assert.equal(wrong.storage.getItem(settingsKey),valid);
  const envelope=JSON.parse(valid),bytes=Buffer.from(envelope.ciphertext,'base64');bytes[0]^=1;envelope.ciphertext=bytes.toString('base64');f.storage.setItem(settingsKey,JSON.stringify(envelope));await assert.rejects(f.store.read(),/无法解密/);assert.notEqual(f.storage.getItem(settingsKey),valid);
  assert.equal((await f.store.clear()).profiles[0].hasApiKey,false);assert.equal(f.storage.getItem(settingsKey),null);
});
test('encrypted custom configurations still switch, clear and isolate browsers',async()=>{
  const f=fixture();let state=await f.store.save(await f.store.read(),{provider:'deepseek',apiKey:'deepseek-secret'});
  state=await f.store.save(state,{provider:'custom',name:'Claude',protocol:'claude',baseUrl:'https://api.anthropic.com/v1',model:'test',apiKey:'claude-secret'});const id=state.activeProfileId;
  state=await f.store.select(state,'deepseek');assert.equal((await f.store.read()).activeProfileId,'deepseek');
  state=await f.store.delete(state,id);assert.equal(state.profiles.length,1);state=await f.store.delete(state,'deepseek');assert.equal((await f.store.read()).profiles[0].hasApiKey,false);
  assert.equal((await fixture().store.read()).profiles[0].hasApiKey,false);
});
test('storage and key failures never fall back to plaintext or overwrite the previous ciphertext',async()=>{
  const f=fixture();let state=await f.store.save(await f.store.read(),{provider:'deepseek',apiKey:'preserved-secret'});const previous=f.storage.getItem(settingsKey);
  f.storage.setItem=()=>{throw new Error('QuotaExceeded');};await assert.rejects(f.store.save(state,{provider:'deepseek',apiKey:'unsaved-secret'}),/无法保存/);assert.equal(f.storage.getItem(settingsKey),previous);assert.equal((await f.store.read()).profiles[0].apiKey,'preserved-secret');
  const broken=createBrowserSettings({...f.options,keyStore:{async get(){throw new Error('IDB blocked');}}});await assert.rejects(broken.save(state,{provider:'deepseek',apiKey:'unsaved-secret'}),/IDB blocked/);assert.equal(f.storage.getItem(settingsKey),previous);
});
