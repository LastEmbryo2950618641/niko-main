const $=id=>document.getElementById(id);
const chatPanel=$('chat-panel'),chatToggle=$('chat-toggle'),chatInput=$('chat-input'),messagesNode=$('chat-messages');
const dialog=$('api-dialog'),profileSelect=$('api-profile'),keyInput=$('api-key');
const initialProfile={id:'deepseek',name:'DeepSeek',provider:'deepseek',protocol:'openai',hasApiKey:false};
let settings={activeProfileId:'deepseek',profiles:[initialProfile]},ready=false,loading,controller,preparing=false,frame,historyTimer;
let conversation=[];
try {
  const stored=JSON.parse(sessionStorage.getItem('site-shelf.chat.messages.v1')??'[]');
  if(Array.isArray(stored)) conversation=stored.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string').map(m=>({...m,status:m.status==='working'?'stopped':m.status}));
} catch {}
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
  profileSelect.replaceChildren(option('__new','＋ 添加自定义配置'),...next.profiles.map(p=>option(p.id,p.name)));
  profileSelect.value=next.profiles.some(p=>p.id===previous)?previous:next.activeProfileId;
  renderMessages();
}
async function loadSettings() {
  if(ready) return;
  if(!loading) loading=api('config').then(response=>response.json()).then(next=>{updateSettings(next);ready=true;}).finally(()=>{loading=undefined;});
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
  keyInput.placeholder=profile?.hasApiKey?'已保存，留空不修改':'输入你的 API Key';
  $('api-key-toggle').textContent='显示';$('api-key-toggle').setAttribute('aria-label','显示 API Key');
  $('api-delete').hidden=!profile?.hasApiKey&&id==='deepseek'||!profile;
  $('api-delete').textContent=id==='deepseek'?'清除 Key':'删除配置';apiStatus('');
}
async function openSettings() {
  if(!dialog.open) dialog.showModal();
  $('api-transport').hidden=location.protocol==='https:'||['localhost','127.0.0.1'].includes(location.hostname);
  $('api-save').disabled=true;apiStatus('正在读取配置…');
  try {await loadSettings();fillProfile(settings.activeProfileId);$('api-save').disabled=false;}
  catch(error) {apiStatus(error.message,true);}
}
function closeSettings(){dialog.close();}
dialog.addEventListener('close',()=>{keyInput.value='';keyInput.type='password';$('api-status').textContent='';});
$('api-settings-open').addEventListener('click',()=>void openSettings());
for(const id of ['api-close','api-cancel']) $(id).addEventListener('click',closeSettings);
profileSelect.addEventListener('change',()=>fillProfile(profileSelect.value));
$('api-protocol').addEventListener('change',()=>{
  const isClaude=$('api-protocol').value==='claude';
  $('api-base').placeholder=isClaude?'https://api.anthropic.com/v1':'https://api.openai.com/v1';
});
$('api-key-toggle').addEventListener('click',()=>{const reveal=keyInput.type==='password';keyInput.type=reveal?'text':'password';$('api-key-toggle').textContent=reveal?'隐藏':'显示';$('api-key-toggle').setAttribute('aria-label',reveal?'隐藏 API Key':'显示 API Key');});
$('api-form').addEventListener('submit',async event=>{
  event.preventDefault();if($('api-save').disabled) return;
  const builtin=profileSelect.value==='deepseek';
  const body={provider:builtin?'deepseek':'custom',apiKey:keyInput.value};
  if(!builtin) Object.assign(body,{...(profileSelect.value==='__new'?{}:{id:profileSelect.value}),name:$('api-name').value,protocol:$('api-protocol').value,baseUrl:$('api-base').value,model:$('api-model').value});
  $('api-save').disabled=true;$('api-delete').disabled=true;apiStatus('正在保存…');
  try {updateSettings(await (await api('config',{method:'PUT',body})).json());fillProfile(settings.activeProfileId);closeSettings();notice('配置已保存，可以开始对话。');chatInput.focus();}
  catch(error) {apiStatus(error.message,true);}
  finally {$('api-save').disabled=false;$('api-delete').disabled=false;}
});
$('api-delete').addEventListener('click',async()=>{
  $('api-delete').disabled=true;$('api-save').disabled=true;
  try {updateSettings(await (await api('config',{method:'DELETE',body:{id:profileSelect.value}})).json());fillProfile(settings.activeProfileId);apiStatus('已清除。');}
  catch(error) {apiStatus(error.message,true);}
  finally {$('api-delete').disabled=false;$('api-save').disabled=false;}
});
$('chat-profile').addEventListener('change',async()=>{
  const select=$('chat-profile');select.disabled=true;
  try {updateSettings(await (await api('active',{method:'POST',body:{id:select.value}})).json());notice('已切换配置；后续消息使用新配置。');}
  catch(error) {select.value=settings.activeProfileId;notice(error.message);}
  finally {select.disabled=Boolean(controller);}
});

function persistConversation() {
  clearTimeout(historyTimer);
  historyTimer=setTimeout(()=>{try {sessionStorage.setItem('site-shelf.chat.messages.v1',JSON.stringify(conversation));} catch {notice('浏览器存储空间不足，对话仅在此页面内保留。');}},400);
}
function element(tag,className,text) {const node=document.createElement(tag);if(className) node.className=className;if(text!==undefined) node.textContent=text;return node;}
function renderMessages() {
  const follow=messagesNode.scrollHeight-messagesNode.scrollTop-messagesNode.clientHeight<70;
  if(!conversation.length) {
    const empty=element('div','chat-empty');empty.append(element('strong',null,'想聊点什么？'),element('p',null,'选择一个 API 配置，随时在收藏页问问题、整理灵感。'));
    if(!settings.profiles.some(p=>p.hasApiKey)) {const button=element('button','chat-text-button','配置 API Key');button.type='button';button.addEventListener('click',()=>void openSettings());empty.append(button);}
    messagesNode.replaceChildren(empty);return;
  }
  const fragment=document.createDocumentFragment();
  for(const message of conversation) {
    const article=element('article',`chat-message chat-message--${message.role}`);
    article.append(element('p','chat-message__label',message.role==='user'?'你':message.label??'助手'));
    if(message.reasoning) {const details=element('details','chat-message__reasoning');details.append(element('summary',null,'思考过程'),element('p',null,message.reasoning));article.append(details);}
    article.append(element('div','chat-message__body',message.text||(message.status==='working'?'正在思考…':message.status==='stopped'?'已停止。':'未收到回复。')));
    if(message.error) article.append(element('p','chat-message__error',message.error));
    if(message.status==='stopped'&&message.text) article.append(element('p','chat-message__label','已停止生成，以上内容已保留。'));
    fragment.append(article);
  }
  messagesNode.replaceChildren(fragment);
  if(follow) messagesNode.scrollTop=messagesNode.scrollHeight;
}
function queueRender() {if(!frame) frame=requestAnimationFrame(()=>{frame=undefined;renderMessages();});persistConversation();}
function setRunning(running) {$('chat-send').hidden=running;$('chat-stop').hidden=!running;$('chat-profile').disabled=running;$('chat-new').disabled=running;chatInput.readOnly=running;messagesNode.setAttribute('aria-busy',String(running));}
function resizeInput(){chatInput.style.height='auto';chatInput.style.height=Math.min(100,chatInput.scrollHeight)+'px';}
chatInput.addEventListener('input',resizeInput);
chatInput.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!event.ctrlKey&&!event.metaKey){event.preventDefault();if(!controller) $('chat-form').requestSubmit();}});
chatToggle.addEventListener('click',()=>{
  const open=chatPanel.hidden;chatPanel.hidden=!open;chatToggle.setAttribute('aria-expanded',String(open));
  if(open) {renderMessages();resizeInput();chatInput.focus();void loadSettings().catch(error=>notice(error.message));}
});
$('chat-new').addEventListener('click',()=>{if(controller) return;conversation=[];renderMessages();persistConversation();notice('已开始新对话。');chatInput.focus();});
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
  preparing=true;
  try {await loadSettings();} catch(error) {notice(error.message);return;} finally {preparing=false;}
  const profile=settings.profiles.find(p=>p.id===settings.activeProfileId);
  if(!profile?.hasApiKey) {notice('请先保存 API Key。');void openSettings();return;}
  const history=conversation.filter(m=>m.text.trim()).map(m=>({role:m.role,content:m.text}));history.push({role:'user',content:text});
  if(history.length>200||JSON.stringify(history).length>240000) {notice('对话内容已较多，请点击“新对话”后继续。');return;}
  conversation.push({role:'user',text,status:'complete'});
  const answer={role:'assistant',text:'',reasoning:'',status:'working',label:profile.name};conversation.push(answer);
  controller=new AbortController();setRunning(true);chatInput.value='';resizeInput();renderMessages();messagesNode.scrollTop=messagesNode.scrollHeight;persistConversation();notice('正在回复，可以随时停止；折叠面板不会中断对话。');
  try {
    const response=await api('chat',{method:'POST',body:{profileId:profile.id,messages:history},signal:controller.signal});let done=false;
    for await(const event of eventsFrom(response)) {
      if(event.type==='text') answer.text+=event.text;
      if(event.type==='reasoning') answer.reasoning+=event.text;
      if(event.type==='warning') notice(event.message);
      if(event.type==='error') throw new Error(event.message);
      if(event.type==='done') done=true;
      queueRender();
    }
    if(!done) throw new Error('连接提前断开，已保留收到的内容。');
    answer.status='complete';notice('回复完成。Enter 发送，Shift + Enter 换行。');
  } catch(error) {
    answer.status=controller.signal.aborted?'stopped':'error';
    if(answer.status==='error') answer.error=error.message;
    notice(answer.status==='stopped'?'已停止，没有自动重试。':'回复失败，没有自动重试；可以检查配置后重新发送。');
  } finally {controller=undefined;setRunning(false);queueRender();chatInput.focus();}
});
window.addEventListener('pagehide',()=>{controller?.abort();try {sessionStorage.setItem('site-shelf.chat.messages.v1',JSON.stringify(conversation));} catch {}});
renderMessages();
