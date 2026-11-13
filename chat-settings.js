export const settingsKey='site-shelf.chat.settings.v1';
export const deepseekProfile=Object.freeze({id:'deepseek',name:'DeepSeek',provider:'deepseek',protocol:'openai',baseUrl:'https://api.deepseek.com/v1',model:'deepseek-flash',apiKey:''});
const initialSettings=()=>({activeProfileId:'deepseek',profiles:[{...deepseekProfile,hasApiKey:false}]});
function text(value,max,label){
  if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`请填写有效的${label}`);
  return value.trim();
}
export function normalizeProfile(input,old,{allowEmpty=false}={}){
  if(!input||Array.isArray(input)||typeof input!=='object'||!['deepseek','custom'].includes(input.provider))throw new Error('配置类型无效');
  const builtin=input.provider==='deepseek',id=builtin?'deepseek':input.id;
  if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(id)||(!builtin&&id==='deepseek'))throw new Error('配置标识无效');
  const apiKey=typeof input.apiKey==='string'&&input.apiKey.trim()?text(input.apiKey,4096,'API Key'):old?.apiKey??'';
  if(/[\r\n\x00-\x1f\x7f]/.test(apiKey))throw new Error('API Key 包含无效字符');
  if(!apiKey&&!allowEmpty)throw new Error('请填写 API Key');
  if(builtin)return {...deepseekProfile,apiKey};
  if(!['openai','claude'].includes(input.protocol))throw new Error('请选择 OpenAI 或 Claude 协议');
  let base;
  try{base=new URL(text(input.baseUrl,2048,'Base URL'));}catch{throw new Error('请填写完整的 HTTPS Base URL');}
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new Error('Base URL 必须使用 HTTPS，且不能包含账号、查询参数或锚点');
  return {id,provider:'custom',name:text(input.name,50,'配置名称'),protocol:input.protocol,baseUrl:base.href.replace(/\/+$/,''),model:text(input.model,150,'模型名称'),apiKey};
}
function withFlags(state){return {...state,profiles:state.profiles.map(p=>({...p,hasApiKey:Boolean(p.apiKey)}))};}
export function readSettings(storage){
  let raw;
  try{raw=storage.getItem(settingsKey);}catch{throw new Error('浏览器禁止读取本地配置，请允许本站使用本地存储。');}
  if(!raw)return initialSettings();
  try{
    const saved=JSON.parse(raw);
    if(!Array.isArray(saved?.profiles)||saved.profiles.length>12)throw new Error();
    const profiles=saved.profiles.map(p=>normalizeProfile(p,undefined,{allowEmpty:true}));
    if(new Set(profiles.map(p=>p.id)).size!==profiles.length)throw new Error();
    if(!profiles.some(p=>p.id==='deepseek'))profiles.unshift({...deepseekProfile});
    if(profiles.length>12)throw new Error();
    return withFlags({activeProfileId:profiles.some(p=>p.id===saved.activeProfileId)?saved.activeProfileId:'deepseek',profiles});
  }catch{throw new Error('本地 API 配置无法读取，请清除此站点的 API 配置后重新填写。');}
}
function persist(storage,state){
  const saved={activeProfileId:state.activeProfileId,profiles:state.profiles.map(({hasApiKey,...p})=>p)};
  try{storage.setItem(settingsKey,JSON.stringify(saved));}catch{throw new Error('浏览器无法保存 API 配置，请检查本地存储权限或可用空间。');}
  return withFlags(saved);
}
export function saveProfile(storage,state,input){
  const id=input.provider==='deepseek'?'deepseek':input.id??Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const old=state.profiles.find(p=>p.id===id),profile=normalizeProfile({...input,id},old);
  if(!old&&state.profiles.length>=12)throw new Error('最多保存 12 个配置，请先删除不再使用的配置');
  const profiles=old?state.profiles.map(p=>p.id===id?profile:p):[...state.profiles,profile];
  return persist(storage,{activeProfileId:id,profiles});
}
export function deleteProfile(storage,state,id){
  const profiles=id==='deepseek'?state.profiles.map(p=>p.id===id?{...deepseekProfile}:p):state.profiles.filter(p=>p.id!==id);
  return persist(storage,{activeProfileId:state.activeProfileId===id?'deepseek':state.activeProfileId,profiles});
}
export function selectProfile(storage,state,id){
  if(!state.profiles.some(p=>p.id===id))throw new Error('配置不存在');
  return persist(storage,{...state,activeProfileId:id});
}
