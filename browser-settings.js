import {readSettings,saveProfile,deleteProfile,selectProfile,settingsKey} from './chat-settings.js?v=1';

export {settingsKey};
const keyDatabase='site-shelf.chat.crypto.v1',keyId='settings-key';
const additionalData=new TextEncoder().encode('site-shelf.chat.settings.v2');
const browserStorage={getItem:key=>globalThis.localStorage.getItem(key),setItem:(key,value)=>globalThis.localStorage.setItem(key,value),removeItem:key=>globalThis.localStorage.removeItem(key)};

// The encryption key stays in this browser as a non-exportable CryptoKey.
// This protects stored copies, not against malicious scripts running on this origin.
export function createIndexedKeyStore({indexedDB=globalThis.indexedDB,crypto=globalThis.crypto}={}) {
  async function open() {
    if(!indexedDB)throw new Error('浏览器不支持安全存储');
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(keyDatabase,1);let blocked=false;
      request.onupgradeneeded=()=>request.result.createObjectStore('keys');
      request.onerror=()=>reject(new Error('无法打开安全存储，请检查浏览器权限。'));
      request.onblocked=()=>{blocked=true;reject(new Error('安全存储被占用，请关闭其他本站标签页后重试。'));};
      request.onsuccess=()=>{if(blocked)request.result.close();else resolve(request.result);};
    });
  }
  async function transact(mode,candidate) {
    const db=await open();
    try{return await new Promise((resolve,reject)=>{
      const transaction=db.transaction('keys',mode),store=transaction.objectStore('keys'),request=store.get(keyId);let key;
      request.onsuccess=()=>{key=request.result;if(!key&&candidate){key=candidate;store.put(key,keyId);}};
      transaction.oncomplete=()=>resolve(key);
      transaction.onerror=transaction.onabort=()=>reject(new Error('无法访问安全存储，请检查浏览器权限。'));
    });}finally{db.close();}
  }
  return {async get({create=false}={}) {
    const existing=await transact('readonly');
    if(existing||!create)return existing;
    const candidate=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    // Re-read in one read/write transaction: simultaneous tabs must retain the same key.
    return transact('readwrite',candidate);
  }};
}
function memoryStorage(value) {
  return {getItem:()=>value,setItem:(_key,next)=>{value=next;}};
}
function encode(bytes) {
  let result='';for(let start=0;start<bytes.length;start+=8192)result+=String.fromCharCode(...bytes.subarray(start,start+8192));
  return btoa(result);
}
function decode(value) {
  if(typeof value!=='string'||value.length>350000||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('Invalid ciphertext');
  return Uint8Array.from(atob(value),character=>character.charCodeAt(0));
}
export function createBrowserSettings({storage=browserStorage,crypto=globalThis.crypto,keyStore=createIndexedKeyStore({crypto}),secureContext=globalThis.isSecureContext}={}) {
  function requireCrypto() {
    if(!secureContext||!crypto?.subtle)throw new Error('请通过 HTTPS 配置 API Key');
  }
  function rawSettings() {
    try{return storage.getItem(settingsKey);}catch{throw new Error('浏览器禁止读取本地配置');}
  }
  async function persist(state) {
    requireCrypto();
    const key=await keyStore.get({create:true}),iv=crypto.getRandomValues(new Uint8Array(12));
    const serialized=JSON.stringify({activeProfileId:state.activeProfileId,profiles:state.profiles.map(({hasApiKey,...profile})=>profile)});
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData},key,new TextEncoder().encode(serialized));
    const envelope={version:2,algorithm:'AES-GCM',iv:encode(iv),ciphertext:encode(new Uint8Array(ciphertext))};
    try{storage.setItem(settingsKey,JSON.stringify(envelope));}catch{throw new Error('无法保存加密配置，请检查浏览器存储空间。');}
    return state;
  }
  let pending=Promise.resolve();
  function sequential(task){const result=pending.then(task);pending=result.catch(()=>{});return result;}
  return {
    read:()=>sequential(async()=>{
      const raw=rawSettings();if(!raw)return readSettings(memoryStorage(null));
      requireCrypto();
      let envelope;
      try{envelope=JSON.parse(raw);}catch{throw new Error('本地配置已损坏，请重置后填写。');}
      if(envelope?.version===2) {
        try {
          if(envelope.algorithm!=='AES-GCM')throw new Error();
          const key=await keyStore.get();if(!key)throw new Error();
          const iv=decode(envelope.iv);if(iv.length!==12)throw new Error();
          const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData},key,decode(envelope.ciphertext));
          return readSettings(memoryStorage(new TextDecoder('utf-8',{fatal:true}).decode(plaintext)));
        }catch{throw new Error('无法解密本地配置，请重置后填写。');}
      }
      // Upgrade legacy plaintext only after successful encryption. Never discard an unreadable configuration.
      return persist(readSettings(memoryStorage(raw)));
    }),
    save:(state,input)=>sequential(()=>persist(saveProfile(memoryStorage(null),state,input))),
    delete:(state,id)=>sequential(()=>persist(deleteProfile(memoryStorage(null),state,id))),
    select:(state,id)=>sequential(()=>persist(selectProfile(memoryStorage(null),state,id))),
    clear:()=>sequential(()=>{try{storage.removeItem(settingsKey);}catch{throw new Error('无法重置本地配置');}return readSettings(memoryStorage(null));})
  };
}
