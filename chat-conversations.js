export const conversationsKey='site-shelf.chat.conversations.v1';
export const legacyMessagesKey='site-shelf.chat.messages.v1';
const browserStorage={getItem:key=>globalThis.sessionStorage.getItem(key),setItem:(key,value)=>globalThis.sessionStorage.setItem(key,value),removeItem:key=>globalThis.sessionStorage.removeItem(key)};

export function conversationTitle(conversation) {
  const text=conversation.messages.find(message=>message.role==='user'&&message.text.trim())?.text||conversation.draft||'新对话';
  return text.replace(/\s+/g,' ').trim().slice(0,40)||'新对话';
}
function messagesFrom(messages,restoring=false) {
  return messages.filter(message=>message&&['user','assistant'].includes(message.role)&&typeof message.text==='string').map(message=>({
    role:message.role,text:message.text,
    ...Object.fromEntries(['reasoning','label','error','status'].filter(key=>typeof message[key]==='string').map(key=>[key,key==='status'&&restoring&&message[key]==='working'?'stopped':message[key]])),
  }));
}
export function createConversationArchive({storage=browserStorage,now=Date.now,uid=()=>globalThis.crypto.randomUUID()}={}) {
  const create=()=>({id:uid(),createdAt:now(),updatedAt:now(),draft:'',messages:[]});
  function save(state) {
    const snapshot={version:1,activeId:state.activeId,items:state.items.map(item=>({id:item.id,createdAt:item.createdAt,updatedAt:item.updatedAt,draft:item.draft,messages:messagesFrom(item.messages)}))};
    try {storage.setItem(conversationsKey,JSON.stringify(snapshot));}
    catch {throw new Error('对话存储失败，刷新可能丢失本次修改。');}
  }
  function load() {
    let raw,legacy;
    try {raw=storage.getItem(conversationsKey);legacy=raw?null:storage.getItem(legacyMessagesKey);}
    catch {throw new Error('无法读取本地对话，旧记录已保留。');}
    if(raw) {
      try {
        const state=JSON.parse(raw),ids=new Set();
        if(state.version!==1||!Array.isArray(state.items)||!state.items.length)throw new Error();
        const items=state.items.map(item=>{
          if(!item||typeof item.id!=='string'||ids.has(item.id)||!Array.isArray(item.messages))throw new Error();
          ids.add(item.id);return {id:item.id,createdAt:Number(item.createdAt)||now(),updatedAt:Number(item.updatedAt)||now(),draft:typeof item.draft==='string'?item.draft:'',messages:messagesFrom(item.messages,true)};
        });
        return {activeId:ids.has(state.activeId)?state.activeId:items[0].id,items};
      } catch {throw new Error('无法读取本地对话，旧记录已保留。');}
    }
    const first=create(),state={activeId:first.id,items:[first]};
    if(legacy) {
      let messages;try {messages=JSON.parse(legacy);if(!Array.isArray(messages))throw new Error();}catch {throw new Error('无法读取原有对话，旧记录已保留。');}
      first.messages=messagesFrom(messages,true);save(state);
      try {storage.removeItem(legacyMessagesKey);}catch {} // The archive is already durable; retaining the legacy copy is harmless.
    }
    return state;
  }
  return {create,load,save};
}
