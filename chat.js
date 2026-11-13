import {createBrowserSettings,settingsKey} from './browser-settings.js?v=1';
import {createChatTransition,showDialog,hideDialog} from './ui-motion.js?v=1';
import {enhanceSelects} from './select-menu.js?v=4';
import {createConversationArchive,conversationTitle} from './chat-conversations.js?v=1';
import {createIcon,setIconLabel} from './site-icons.js?v=2';
const $=id=>document.getElementById(id);
const chatPanel=$('chat-panel'),chatToggle=$('chat-toggle'),chatInput=$('chat-input'),messagesNode=$('chat-messages');
const dialog=$('api-dialog'),profileSelect=$('api-profile'),keyInput=$('api-key');
const settingsStore=createBrowserSettings();
const selectMenus=enhanceSelects(document.querySelectorAll('.chat-profile select,.api-form select'));
const initialProfile={id:'deepseek',name:'DeepSeek',provider:'deepseek',protocol:'openai',hasApiKey:false};
let settings={activeProfileId:'deepseek',profiles:[initialProfile]},ready=false,loading,settingsRevision=0,controller,preparing=false,frame,historyTimer;
const conversationArchive=createConversationArchive();let archiveState,archiveError,archiveWritable=true;
try {archiveState=conversationArchive.load();}
catch(error) {const first=conversationArchive.create();archiveState={activeId:first.id,items:[first]};archiveError=error.message;archiveWritable=false;}
let activeConversation=archiveState.items.find(item=>item.id===archiveState.activeId),conversation=activeConversation.messages;
chatInput.value=activeConversation.draft;
const notice=message=>{$('chat-notice').textContent=message;};
function apiStatus(message,error=false) {$('api-status').textContent=message;$('api-status').classList.toggle('is-error',error);}
async function api(path,{method='GET',body,signal}={}) {
  const response=await fetch('/chat-api/'+path,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal});
  if(!response.ok) { let message;try {message=(await response.json()).error;} catch {}throw new Error(message??`配置服务暂时不可用（HTTP ${response.status}）`); }
  return response;
}
function option(value,label) {const node=document.createElement('option');node.value=value;node.textContent=label;return node;}
function updateSettings(next) {
  settings=next;
  $('chat-profile').replaceChildren(...next.profiles.map(p=>option(p.id,p.name+(p.hasApiKey?'':' · 未配置'))));
  $('chat-profile').value=next.activeProfileId;
  const previous=profileSelect.value;
  profileSelect.replaceChildren(option('__new','＋ 新配置'),...next.profiles.map(p=>option(p.id,p.name)));
  profileSelect.value=next.profiles.some(p=>p.id===previous)?previous:next.activeProfileId;
  selectMenus.refresh();
  renderMessages();
}
async function loadSettings() {
  if(ready) return;
  if(!loading) loading=(async()=>{
    // Storage events may arrive while IndexedDB/decryption is pending. Read the latest write.
    while(!ready){const revision=settingsRevision,next=await settingsStore.read();if(revision!==settingsRevision)continue;updateSettings(next);ready=true;}
  })().finally(()=>{loading=undefined;});
  return loading;
}
function fillProfile(id) {
  const profile=settings.profiles.find(p=>p.id===id),custom=id!=='deepseek';
  profileSelect.value=profile?.id??'__new';
  $('api-custom-fields').hidden=!custom;$('api-deepseek-help').hidden=custom;
  $('api-name').value=profile?.provider==='custom'?profile.name:'';
  $('api-protocol').value=profile?.protocol??'openai';
  $('api-base').value=profile?.provider==='custom'?profile.baseUrl:'';
  $('api-model').value=profile?.provider==='custom'?profile.model:'';
  for(const id of ['api-name','api-base','api-model']) {$(id).required=custom;$(id).disabled=!custom;}
  keyInput.value='';keyInput.type='password';keyInput.required=!profile?.hasApiKey;
  keyInput.placeholder=profile?.hasApiKey?'已保存，留空不修改':'粘贴 Key';
  $('api-key-toggle').replaceChildren(createIcon('eye'));$('api-key-toggle').setAttribute('aria-label','显示 API Key');$('api-key-toggle').title='显示 API Key';
  $('api-delete').hidden=!profile?.hasApiKey&&id==='deepseek'||!profile;
  setIconLabel($('api-delete'),id==='deepseek'?'清除 Key':'删除配置','trash');apiStatus('');
  selectMenus.refresh();
}
async function openSettings() {
  if(!dialog.open||dialog.hasAttribute('data-closing')) void showDialog(dialog);
  $('api-transport').hidden=location.protocol==='https:'||['localhost','127.0.0.1'].includes(location.hostname);
  $('api-save').disabled=true;apiStatus('读取中…');
  $('api-reset').hidden=true;
  try {await loadSettings();fillProfile(settings.activeProfileId);$('api-save').disabled=false;}
  catch(error) {apiStatus(error.message,true);$('api-reset').hidden=!window.isSecureContext;}
}
function closeSettings(){return hideDialog(dialog);}
dialog.addEventListener('close',()=>{keyInput.value='';keyInput.type='password';$('api-status').textContent='';});
$('api-settings-open').addEventListener('click',()=>void openSettings());
for(const id of ['api-close','api-cancel']) $(id).addEventListener('click',closeSettings);
profileSelect.addEventListener('change',()=>fillProfile(profileSelect.value));
$('api-protocol').addEventListener('change',()=>{
  const isClaude=$('api-protocol').value==='claude';
  $('api-base').placeholder=isClaude?'https://api.anthropic.com/v1':'https://api.openai.com/v1';
});
$('api-key-toggle').addEventListener('click',()=>{const reveal=keyInput.type==='password',label=reveal?'隐藏 API Key':'显示 API Key';keyInput.type=reveal?'text':'password';$('api-key-toggle').replaceChildren(createIcon(reveal?'eye-slash':'eye'));$('api-key-toggle').setAttribute('aria-label',label);$('api-key-toggle').title=label;});
$('api-form').addEventListener('submit',async event=>{
  event.preventDefault();if($('api-save').disabled) return;
  const builtin=profileSelect.value==='deepseek';
  const body={provider:builtin?'deepseek':'custom',apiKey:keyInput.value};
  if(!builtin) Object.assign(body,{...(profileSelect.value==='__new'?{}:{id:profileSelect.value}),name:$('api-name').value,protocol:$('api-protocol').value,baseUrl:$('api-base').value,model:$('api-model').value});
  $('api-save').disabled=true;$('api-delete').disabled=true;apiStatus('保存中…');
  try {updateSettings(await settingsStore.save(settings,body));fillProfile(settings.activeProfileId);await closeSettings();notice('已加密保存');chatInput.focus({preventScroll:true});}
  catch(error) {apiStatus(error.message,true);}
  finally {$('api-save').disabled=false;$('api-delete').disabled=false;}
});
$('api-delete').addEventListener('click',async()=>{
  $('api-delete').disabled=true;$('api-save').disabled=true;
  try {updateSettings(await settingsStore.delete(settings,profileSelect.value));fillProfile(settings.activeProfileId);apiStatus('已清除');}
  catch(error) {apiStatus(error.message,true);}
  finally {$('api-delete').disabled=false;$('api-save').disabled=false;}
});
$('chat-profile').addEventListener('change',async()=>{
  const select=$('chat-profile');select.disabled=true;
  try {updateSettings(await settingsStore.select(settings,select.value));notice('已切换');}
  catch(error) {select.value=settings.activeProfileId;notice(error.message);}
  finally {select.disabled=Boolean(controller);}
});
$('api-reset').addEventListener('click',async()=>{
  if(!confirm('清除当前浏览器的全部 API 配置？'))return;
  try{updateSettings(await settingsStore.clear());ready=true;fillProfile(settings.activeProfileId);$('api-reset').hidden=true;$('api-save').disabled=false;}
  catch(error){apiStatus(error.message,true);}
});

function persistConversation() {
  clearTimeout(historyTimer);
  historyTimer=setTimeout(flushConversation,400);
}
function flushConversation() {
  clearTimeout(historyTimer);activeConversation.messages=conversation;activeConversation.draft=chatInput.value;
  if(!archiveWritable)return;
  try {conversationArchive.save(archiveState);}catch(error){notice(error.message);}
}
function element(tag,className,text) {const node=document.createElement(tag);if(className) node.className=className;if(text!==undefined) node.textContent=text;return node;}
function renderConversations() {
  const fragment=document.createDocumentFragment();
  for(const item of [...archiveState.items].sort((a,b)=>b.updatedAt-a.updatedAt)) {
    const button=element('button','chat-history__item');setIconLabel(button,conversationTitle(item),'paw-print');button.type='button';button.dataset.conversationId=item.id;button.title=conversationTitle(item);button.disabled=Boolean(controller)||preparing;
    if(item.id===archiveState.activeId)button.setAttribute('aria-current','true');
    button.addEventListener('click',()=>activateConversation(item.id));fragment.append(button);
  }
  $('chat-history-list').replaceChildren(fragment);
}
function setHistoryOpen(open) {
  const toggle=$('chat-history-toggle'),mobile=matchMedia('(max-width:639px)').matches;
  $('chat-history').classList.toggle('is-expanded',open);toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'收起对话列表':'展开对话列表');toggle.title=open?'收起对话列表':'展开对话列表';
  $('chat-history-content').inert=!open;$('chat-history-content').setAttribute('aria-hidden',String(!open));$('chat-history-backdrop').hidden=!open||!mobile;
  document.querySelector('.chat-content').inert=open&&mobile;
}
function activateConversation(id) {
  if(controller||preparing)return;const next=archiveState.items.find(item=>item.id===id);if(!next)return;
  flushConversation();activeConversation=next;archiveState.activeId=id;conversation=next.messages;chatInput.value=next.draft;
  renderMessages();renderConversations();resizeInput();messagesNode.scrollTop=messagesNode.scrollHeight;flushConversation();
  if(matchMedia('(max-width:639px)').matches)setHistoryOpen(false);
  notice('Enter 发送 · Shift + Enter 换行');chatInput.focus({preventScroll:true});
}
$('chat-history-toggle').addEventListener('click',()=>setHistoryOpen($('chat-history-toggle').getAttribute('aria-expanded')!=='true'));
$('chat-history-backdrop').addEventListener('click',()=>{setHistoryOpen(false);$('chat-history-toggle').focus({preventScroll:true});});
$('chat-history').addEventListener('keydown',event=>{if(event.key==='Escape'&&$('chat-history-toggle').getAttribute('aria-expanded')==='true'){event.preventDefault();setHistoryOpen(false);$('chat-history-toggle').focus({preventScroll:true});}});
window.addEventListener('resize',()=>setHistoryOpen($('chat-history-toggle').getAttribute('aria-expanded')==='true'));
function renderMessages() {
  const follow=messagesNode.scrollHeight-messagesNode.scrollTop-messagesNode.clientHeight<70;
  if(!conversation.length) {
    const empty=element('div','chat-empty'),crest=element('div','chat-empty__crest');crest.setAttribute('aria-hidden','true');
    crest.append(createIcon('cat','chat-empty__cat'));empty.append(crest,element('strong',null,'想聊点什么？'));
    if(!settings.profiles.some(p=>p.hasApiKey)) {const button=element('button','chat-text-button');setIconLabel(button,'配置 API Key','key');button.type='button';button.addEventListener('click',()=>void openSettings());empty.append(button);}
    const accessories=element('div','chat-empty__accessories');accessories.setAttribute('aria-hidden','true');accessories.append(createIcon('paw-print-solid'),createIcon('dress-solid'),createIcon('heart-solid'));empty.append(accessories);
    messagesNode.replaceChildren(empty);return;
  }
  const fragment=document.createDocumentFragment();
  for(const message of conversation) {
    const article=element('article',`chat-message chat-message--${message.role}`);
    const label=element('p','chat-message__label',message.role==='user'?'你':message.label??'助手');label.prepend(createIcon(message.role==='user'?'paw-print':'dress'));article.append(label);
    if(message.reasoning) {const details=element('details','chat-message__reasoning'),summary=element('summary',null,'思考过程');summary.prepend(createIcon('sparkle'));details.append(summary,element('p',null,message.reasoning));article.append(details);}
    article.append(element('div','chat-message__body',message.text||(message.status==='working'?'思考中…':message.status==='stopped'?'已停止':'未收到回复')));
    if(message.error) article.append(element('p','chat-message__error',message.error));
    if(message.status==='stopped'&&message.text) article.append(element('p','chat-message__label','已停止 · 内容已保留'));
    fragment.append(article);
  }
  messagesNode.replaceChildren(fragment);
  if(follow) messagesNode.scrollTop=messagesNode.scrollHeight;
}
function queueRender() {if(!frame) frame=requestAnimationFrame(()=>{frame=undefined;renderMessages();});persistConversation();}
function setRunning(running) {$('chat-send').hidden=running;$('chat-stop').hidden=!running;$('chat-profile').disabled=running;$('chat-new').disabled=running;chatInput.readOnly=running;messagesNode.setAttribute('aria-busy',String(running));renderConversations();}
function resizeInput(){chatInput.style.height='auto';chatInput.style.height=Math.min(100,chatInput.scrollHeight)+'px';}
chatInput.addEventListener('input',()=>{resizeInput();activeConversation.draft=chatInput.value;persistConversation();renderConversations();});
chatInput.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!event.ctrlKey&&!event.metaKey){event.preventDefault();if(!controller) $('chat-form').requestSubmit();}});
const transitionChat=createChatTransition(chatPanel,chatToggle);
chatToggle.addEventListener('click',()=>{
  const open=chatToggle.getAttribute('aria-expanded')!=='true';
  if(!open)setHistoryOpen(false);
  const finished=transitionChat(open);
  if(open){renderMessages();resizeInput();void loadSettings().catch(error=>notice(error.message));void finished.then(()=>{if(chatToggle.getAttribute('aria-expanded')==='true'&&!chatPanel.closest('.shelf').dataset.switching)chatInput.focus({preventScroll:true});});}
});
window.addEventListener('storage',event=>{if(event.key===settingsKey||event.key===null){settingsRevision++;ready=false;void loadSettings().then(()=>{if(controller)setRunning(true);}).catch(error=>notice(error.message));}});
$('chat-new').addEventListener('click',()=>{
  if(controller||preparing)return;
  if(!conversation.length&&!chatInput.value.trim()){if(matchMedia('(max-width:639px)').matches)setHistoryOpen(false);chatInput.focus();return;}
  flushConversation();const next=conversationArchive.create();archiveState.items.push(next);activateConversation(next.id);
});
$('chat-stop').addEventListener('click',()=>controller?.abort());

async function* eventsFrom(response) {
  if(!response.body) throw new Error('浏览器不支持流式响应');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  try {
    while(true) {const {value,done}=await reader.read();if(done) break;buffer+=decoder.decode(value,{stream:true});let split;
      while((split=buffer.indexOf('\n\n'))!==-1){const block=buffer.slice(0,split);buffer=buffer.slice(split+2);for(const line of block.split('\n')) if(line.startsWith('data:')) yield JSON.parse(line.slice(5).trim());}
      if(buffer.length>1024*1024) throw new Error('模型响应格式无效');
    }
  } finally {reader.releaseLock();}
}
$('chat-form').addEventListener('submit',async event=>{
  event.preventDefault();const text=chatInput.value.trim();if(!text||controller||preparing) return;
  preparing=true;$('chat-new').disabled=true;renderConversations();
  try {await loadSettings();} catch(error) {notice(error.message);return;} finally {preparing=false;$('chat-new').disabled=Boolean(controller);renderConversations();}
  const profile=settings.profiles.find(p=>p.id===settings.activeProfileId);
  if(!profile?.hasApiKey) {notice('请先配置 API Key');void openSettings();return;}
  const history=conversation.filter(m=>m.text.trim()).map(m=>({role:m.role,content:m.text}));history.push({role:'user',content:text});
  if(history.length>200||JSON.stringify(history).length>240000) {notice('对话已达上限，请新建对话。');return;}
  conversation.push({role:'user',text,status:'complete'});activeConversation.updatedAt=Date.now();
  const answer={role:'assistant',text:'',reasoning:'',status:'working',label:profile.name};conversation.push(answer);
  controller=new AbortController();setRunning(true);chatInput.value='';resizeInput();renderMessages();messagesNode.scrollTop=messagesNode.scrollHeight;persistConversation();notice('回复中…');
  try {
    const {hasApiKey,...requestProfile}=profile;
    const response=await api('chat',{method:'POST',body:{profile:requestProfile,messages:history},signal:controller.signal});let done=false;
    for await(const event of eventsFrom(response)) {
      if(event.type==='text') answer.text+=event.text;
      if(event.type==='reasoning') answer.reasoning+=event.text;
      if(event.type==='warning') notice(event.message);
      if(event.type==='error') throw new Error(event.message);
      if(event.type==='done') done=true;
      queueRender();
    }
    if(!done) throw new Error('连接中断 · 内容已保留');
    answer.status='complete';notice('Enter 发送 · Shift + Enter 换行');
  } catch(error) {
    answer.status=controller.signal.aborted?'stopped':'error';
    if(answer.status==='error') answer.error=error.message;
    notice(answer.status==='stopped'?'已停止':'回复失败，请检查配置。');
  } finally {controller=undefined;setRunning(false);queueRender();chatInput.focus();}
});
window.addEventListener('pagehide',()=>{controller?.abort();flushConversation();});
setIconLabel($('api-reset'),'重置本地配置','trash');renderMessages();renderConversations();if(archiveError)notice(archiveError);
