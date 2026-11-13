import assert from 'node:assert/strict';
import test from 'node:test';
import {createConversationArchive,conversationTitle,conversationsKey,legacyMessagesKey} from '../chat-conversations.js';

function fixture() {
  const data=new Map();let sequence=0;
  const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  const archive=createConversationArchive({storage,now:()=>1000,uid:()=>`conversation-${++sequence}`});
  return {data,storage,archive};
}

test('new conversations retain separate messages, drafts and the active selection on reload',()=>{
  const {archive}=fixture(),state=archive.load(),first=state.items[0];
  assert.equal(state.activeId,first.id);assert.deepEqual(first.messages,[]);
  first.messages.push({role:'user',text:'讨论角色设定',status:'complete'},{role:'assistant',text:'角色资料',status:'complete'});first.draft='未发送的问题';
  const second=archive.create();second.messages.push({role:'user',text:'另一本书',status:'complete'});state.items.push(second);state.activeId=second.id;
  archive.save(state);const loaded=archive.load();
  assert.equal(loaded.activeId,second.id);assert.equal(loaded.items[0].draft,'未发送的问题');assert.equal(loaded.items[0].messages[1].text,'角色资料');assert.equal(loaded.items[1].messages.length,1);
});

test('old single-conversation messages migrate once without losing partial replies or reasoning',()=>{
  const {storage,archive}=fixture();storage.setItem(legacyMessagesKey,JSON.stringify([{role:'user',text:'旧问题'},{role:'assistant',text:'部分回复',reasoning:'已有思考',status:'working'}]));
  const state=archive.load();assert.equal(state.items[0].messages[1].status,'stopped');assert.equal(state.items[0].messages[1].reasoning,'已有思考');
  assert.equal(storage.getItem(legacyMessagesKey),null);assert(storage.getItem(conversationsKey));assert.equal(archive.load().items.length,1);
});

test('failed writes preserve both the previous archive and any legacy conversation',()=>{
  const {storage,archive}=fixture(),state=archive.load();archive.save(state);const previous=storage.getItem(conversationsKey);
  storage.setItem=()=>{throw new Error('quota');};state.items[0].draft='新的草稿';assert.throws(()=>archive.save(state),/存储/);assert.equal(storage.getItem(conversationsKey),previous);
  const old=fixture();old.storage.setItem(legacyMessagesKey,'[{"role":"user","text":"不要丢失"}]');old.storage.setItem=()=>{throw new Error('quota');};assert.throws(()=>old.archive.load(),/存储/);assert(old.storage.getItem(legacyMessagesKey));
});

test('malformed archive is reported without overwriting it, and titles are plain text',()=>{
  const {storage,archive}=fixture();storage.setItem(conversationsKey,'{broken');assert.throws(()=>archive.load(),/读取/);assert.equal(storage.getItem(conversationsKey),'{broken');
  assert.equal(conversationTitle({messages:[{role:'user',text:'第一行\n  第二行'}]}),'第一行 第二行');
  assert.equal(conversationTitle({messages:[{role:'user',text:'<img src=x onerror=alert(1)>'}]}),'<img src=x onerror=alert(1)>');
  assert.equal(conversationTitle({messages:[],draft:''}),'新对话');
});
