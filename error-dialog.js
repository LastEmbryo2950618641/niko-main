import {showDialog,hideDialog} from './ui-motion.js?v=1';
import {createIcon} from './site-icons.js?v=4';

let dialog,active;const waiting=[];
function ensureDialog(){
  if(dialog)return;
  dialog=document.createElement('dialog');dialog.id='error-dialog';dialog.className='add-dialog error-dialog';dialog.setAttribute('role','alertdialog');dialog.setAttribute('aria-labelledby','error-title');dialog.setAttribute('aria-describedby','error-message');
  const content=document.createElement('div');content.className='error-dialog__content';
  const heading=document.createElement('div');heading.className='dialog-heading';
  const title=document.createElement('h2');title.id='error-title';title.className='add-form__title';title.textContent='提示';heading.append(createIcon('bell-ringing'),title);
  const message=document.createElement('p');message.id='error-message';
  const actions=document.createElement('div');actions.className='form-actions';
  const close=document.createElement('button');close.type='button';close.className='form-submit';close.textContent='知道了';close.addEventListener('click',()=>void hideDialog(dialog));
  actions.append(close);content.append(heading,message,actions);dialog.append(content);document.body.append(dialog);
  dialog.addEventListener('close',()=>{const previous=active;active=undefined;previous?.resolve();pump();});
}
function pump(){
  if(active||!waiting.length)return;
  ensureDialog();active=waiting.shift();dialog.querySelector('#error-message').textContent=active.message;
  void showDialog(dialog).then(()=>{if(dialog.open&&!dialog.hasAttribute('data-closing'))dialog.querySelector('button').focus({preventScroll:true});});
}
export function showError(error){
  const message=String(typeof error==='string'?error:error?.message||'操作失败，请稍后重试').slice(0,600);
  const duplicate=[active,...waiting].find(item=>item?.message===message);if(duplicate)return duplicate.promise;
  let resolve;const promise=new Promise(done=>{resolve=done;});waiting.push({message,promise,resolve});pump();return promise;
}
