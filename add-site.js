import {createBrowserSettings,settingsKey} from './browser-settings.js?v=1';
import {showDialog,hideDialog} from './ui-motion.js?v=1';
import {showError} from './error-dialog.js?v=1';
import {normalizeSiteUrl,normalizeSiteDetails,configuredSiteProfile} from './site-details.js?v=2';
import {setIconLabel} from './site-icons.js?v=4';

export function initAddSite({onAdd}){
  const $=id=>document.getElementById(id),dialog=$('add-dialog'),form=$('add-form'),store=createBrowserSettings();
  const fields={name:$('site-name'),url:$('site-url'),note:$('site-note')};
  const fresh=()=>({name:'',url:'',note:'',icon:'bookmark-simple',previewUrl:null,editing:false});
  let drafts={manual:fresh(),ai:fresh()},mode='manual',profile=null,controller,adding=false,ticket=0,settingsTicket=0;
  function saveDraft(){for(const [key,input]of Object.entries(fields))drafts[mode][key]=input.value;}
  function fillDraft(){for(const [key,input]of Object.entries(fields))input.value=drafts[mode][key];}
  function cancel(){ticket++;controller?.abort();controller=undefined;}
  function render(){
    const ai=mode==='ai',draft=drafts[mode],busy=Boolean(controller),preview=ai&&Boolean(draft.previewUrl);
    $('site-mode-ai').disabled=!profile||busy;$('site-mode-ai').title=profile?'':'请先配置模型';$('site-configure-model').hidden=Boolean(profile);
    for(const [id,selected]of [['site-mode-ai',ai],['site-mode-manual',!ai]]){$(id).setAttribute('aria-selected',String(selected));$(id).tabIndex=selected?0:-1;}
    $('site-add-panel').setAttribute('aria-labelledby',ai?'site-mode-ai':'site-mode-manual');
    $('site-name-field').hidden=ai&&(!preview||!draft.editing);$('site-note-field').hidden=ai&&(!preview||!draft.editing);
    $('site-explore-actions').hidden=!ai;$('site-preview').hidden=!preview;
    $('site-model-name').textContent=profile?.name??'';$('site-explore').disabled=busy||!profile;
    setIconLabel($('site-explore'),busy?'生成中…':preview?'重新生成':'生成预览','magic-wand');
    $('site-submit').disabled=busy||adding||(ai&&!preview);form.setAttribute('aria-busy',String(busy||adding));
    for(const input of Object.values(fields))input.readOnly=busy;
    $('site-preview-name').textContent=draft.name;$('site-preview-note').textContent=draft.note;
    $('site-preview-url').textContent=draft.previewUrl??'';
    $('site-preview-icon').querySelector('use').setAttribute('href',`/site-icons.svg?v=5#${draft.icon}`);
    setIconLabel($('site-preview-edit'),draft.editing?'完成修改':'修改','pencil-simple');
  }
  async function refreshProfile(){
    const revision=++settingsTicket;
    try{const next=configuredSiteProfile(await store.read());if(revision!==settingsTicket)return;profile=next;if(!profile&&mode==='ai'){saveDraft();cancel();mode='manual';fillDraft();}render();}
    catch(error){if(revision===settingsTicket){profile=null;render();void showError(error);}}
  }
  function switchMode(next){
    if(next==='ai'&&!profile)return;
    saveDraft();cancel();mode=next;fillDraft();render();(mode==='ai'?fields.url:fields.name).focus({preventScroll:true});
  }
  async function open({preferAI=false}={}){
    fillDraft();render();void showDialog(dialog);(mode==='ai'?fields.url:fields.name).focus({preventScroll:true});
    await refreshProfile();if(preferAI&&profile&&dialog.open)switchMode('ai');
  }
  $('add-site').addEventListener('click',()=>void open());
  for(const id of ['dialog-close','form-cancel'])$(id).addEventListener('click',()=>void hideDialog(dialog));
  dialog.addEventListener('close',()=>{saveDraft();cancel();render();});
  $('site-mode-ai').addEventListener('click',()=>switchMode('ai'));$('site-mode-manual').addEventListener('click',()=>switchMode('manual'));
  $('site-mode-switch').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();switchMode(profile&&(event.key==='Home'||event.key!=='End'&&mode==='manual')?'ai':'manual');}});
  $('site-configure-model').addEventListener('click',async()=>{
    await hideDialog(dialog);$('api-dialog').addEventListener('close',()=>void open({preferAI:true}),{once:true});$('api-settings-open').click();
  });
  for(const input of Object.values(fields))input.addEventListener('input',()=>{
    saveDraft();const draft=drafts[mode];
    if(mode==='ai'&&draft.previewUrl){let current;try{current=normalizeSiteUrl(draft.url);}catch{}if(current!==draft.previewUrl){draft.previewUrl=null;draft.editing=false;}}
    render();
  });
  $('site-preview-edit').addEventListener('click',()=>{saveDraft();drafts.ai.editing=!drafts.ai.editing;render();if(drafts.ai.editing)fields.name.focus({preventScroll:true});});
  $('site-explore').addEventListener('click',async()=>{
    if(controller||mode!=='ai')return;saveDraft();
    let url;try{url=normalizeSiteUrl(fields.url.value);}catch(error){void showError(error);return;}
    const current=++ticket,requestController=new AbortController();controller=requestController;const signal=requestController.signal;let timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;requestController.abort();},100000);render();
    try{
      await refreshProfile();if(current!==ticket||!profile||mode!=='ai'||!dialog.open)return;
      const {hasApiKey,...requestProfile}=profile;
      const response=await fetch('/chat-api/site-preview',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,profile:requestProfile}),signal});
      let body;try{body=await response.json();}catch{throw new Error(`无法读取预览结果（HTTP ${response.status}），请稍后重试`);}
      if(!response.ok)throw new Error(body.error||`生成网站预览失败（HTTP ${response.status}）`);
      const suggestion=normalizeSiteDetails({...body,url});if(current!==ticket||mode!=='ai'||!dialog.open)return;
      drafts.ai={...suggestion,previewUrl:url,editing:false};fillDraft();
    }catch(error){if(current===ticket&&dialog.open)void showError(timedOut?'生成网站预览超时，请稍后重试':error instanceof TypeError?'无法连接 AI 服务，请检查网络或稍后重试':error);}
    finally{clearTimeout(timeout);if(current===ticket){controller=undefined;render();}}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(controller||adding)return;saveDraft();
    if(mode==='ai'&&!drafts.ai.previewUrl){void showError('请先生成网站预览');return;}
    try{
      const site=normalizeSiteDetails(drafts[mode]);adding=true;render();await onAdd(site);
      drafts={manual:fresh(),ai:fresh()};fillDraft();render();await hideDialog(dialog);
    }catch(error){void showError(error);}finally{adding=false;render();}
  });
  window.addEventListener('model-settings-changed',()=>{if(dialog.open)void refreshProfile();});
  window.addEventListener('storage',event=>{if(dialog.open&&(event.key===settingsKey||event.key===null))void refreshProfile();});
  window.addEventListener('pagehide',cancel);render();
}
