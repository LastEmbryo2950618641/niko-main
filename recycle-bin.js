import {showDialog,hideDialog} from './ui-motion.js?v=1';
import {showError} from './error-dialog.js?v=1';
import {createIcon} from './site-icons.js?v=5';
import {libraryKey,legacySitesKey} from './site-library.js?v=2';

export function initRecycleBin({root,library,onChange}){
  const $=id=>document.getElementById(id),bin=$('recycle-bin'),dialog=$('recycle-dialog'),list=$('recycle-list'),confirm=$('recycle-confirm');
  let activeId,touch,ghost,pendingDelete,suppressClickUntil=0,suppressBinClickUntil=0;
  const cardFor=target=>target instanceof Element?target.closest('.card[data-site-id]'):null;
  function render(state){
    const count=state.trash.length;
    $('recycle-count').textContent=String(count);$('recycle-count').hidden=!count;bin.setAttribute('aria-label',count?`回收站，${count} 个网站`:'回收站');
    $('recycle-total').textContent=count?`${count} 个网站`:'';$('recycle-empty').hidden=Boolean(count);list.replaceChildren();
    for(const site of [...state.trash].sort((a,b)=>b.deletedAt-a.deletedAt)){
      const item=document.createElement('li');item.className='recycle-row';item.dataset.siteId=site.id;
      const icon=createIcon(site.icon??'bookmark-simple','recycle-row__icon'),body=document.createElement('div');body.className='recycle-row__body';
      const name=document.createElement('strong');name.textContent=site.name;
      const url=document.createElement('span');url.textContent=new URL(site.url).hostname.replace(/^www\./,'');url.title=site.url;body.append(name,url);
      const actions=document.createElement('div');actions.className='recycle-row__actions';
      for(const [action,label,iconName]of [['restore','恢复','arrow-counter-clockwise'],['delete','彻底删除','trash']]){
        const button=document.createElement('button');button.type='button';button.className=`recycle-action${action==='delete'?' recycle-action--danger':''}`;button.dataset.action=action;button.title=label;button.setAttribute('aria-label',`${label} ${site.name}`);
        const text=document.createElement('span');text.textContent=label;button.append(createIcon(iconName),text);actions.append(button);
      }
      item.append(icon,body,actions);list.append(item);
    }
  }
  function refresh(){try{const state=library.read();onChange(state);render(state);}catch(error){void showError(error);}}
  function change(action,id){try{const state=library[action](id);onChange(state);render(state);return true;}catch(error){void showError(error);return false;}}
  function clearDrag(){
    activeId=undefined;document.body.classList.remove('is-site-dragging');bin.classList.remove('is-over');
    root.querySelectorAll('.is-dragging').forEach(card=>card.classList.remove('is-dragging'));ghost?.remove();ghost=undefined;
    if(touch){clearTimeout(touch.timer);if(touch.card.hasPointerCapture(touch.id))touch.card.releasePointerCapture(touch.id);}touch=undefined;
  }
  function begin(card){activeId=card.dataset.siteId;card.classList.add('is-dragging');document.body.classList.add('is-site-dragging');}
  function overBin(x,y){const b=bin.getBoundingClientRect();return x>=b.left-8&&x<=b.right+8&&y>=b.top-8&&y<=b.bottom+8;}
  bin.addEventListener('click',()=>{if(Date.now()<suppressBinClickUntil||activeId)return;refresh();void showDialog(dialog);});
  $('recycle-close').addEventListener('click',()=>void hideDialog(dialog));
  list.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]'),row=button?.closest('[data-site-id]');if(!row)return;
    if(button.dataset.action==='restore'){
      if(change('restore',row.dataset.siteId)){
        const next=list.querySelector('[data-action="restore"]');(next??$('recycle-close')).focus({preventScroll:true});
      }
    }else{
      try{pendingDelete=library.read().trash.find(site=>site.id===row.dataset.siteId);if(!pendingDelete)return;
        $('recycle-confirm-message').textContent=`彻底删除“${pendingDelete.name}”？`;
        void showDialog(confirm).then(()=>$('recycle-confirm-cancel').focus({preventScroll:true}));
      }catch(error){void showError(error);}
    }
  });
  $('recycle-confirm-cancel').addEventListener('click',()=>void hideDialog(confirm));
  $('recycle-confirm-delete').addEventListener('click',async()=>{
    if(!pendingDelete)return;
    if(change('removeForever',pendingDelete.id)){pendingDelete=undefined;await hideDialog(confirm);(list.querySelector('[data-action="delete"]')??$('recycle-close')).focus({preventScroll:true});}
  });
  confirm.addEventListener('close',()=>{pendingDelete=undefined;});
  root.addEventListener('dragstart',event=>{
    const card=cardFor(event.target);if(!card||!event.dataTransfer)return;
    begin(card);event.dataTransfer.clearData();event.dataTransfer.setData('application/x-niko-site-id',activeId);event.dataTransfer.effectAllowed='move';
  });
  root.addEventListener('dragend',()=>{suppressClickUntil=Date.now()+350;clearDrag();});
  bin.addEventListener('dragover',event=>{event.preventDefault();if(!activeId)return;event.dataTransfer.dropEffect='move';bin.classList.add('is-over');});
  bin.addEventListener('dragleave',event=>{if(!bin.contains(event.relatedTarget))bin.classList.remove('is-over');});
  bin.addEventListener('drop',event=>{event.preventDefault();const id=activeId;clearDrag();suppressClickUntil=Date.now()+350;suppressBinClickUntil=Date.now()+150;if(id)change('moveToTrash',id);});
  root.addEventListener('click',event=>{if(Date.now()<suppressClickUntil&&cardFor(event.target)){event.preventDefault();event.stopPropagation();}},true);
  root.addEventListener('keydown',event=>{
    const card=cardFor(event.target);if(!card||event.key!=='Delete')return;event.preventDefault();
    if(change('moveToTrash',card.dataset.siteId))bin.focus({preventScroll:true});
  });
  root.addEventListener('pointerdown',event=>{
    if(event.pointerType==='mouse'||!event.isPrimary)return;const card=cardFor(event.target);if(!card)return;
    clearDrag();touch={id:event.pointerId,card,x:event.clientX,y:event.clientY,active:false};const current=touch;
    current.timer=setTimeout(()=>{
      if(touch!==current)return;current.active=true;begin(card);card.setPointerCapture(current.id);
      const rect=card.getBoundingClientRect();ghost=card.cloneNode(true);ghost.className='site-drag-ghost';ghost.removeAttribute('href');ghost.removeAttribute('draggable');ghost.setAttribute('aria-hidden','true');
      ghost.style.width=rect.width+'px';ghost.style.height=rect.height+'px';document.body.append(ghost);moveGhost(current.x,current.y);
    },380);
  });
  function moveGhost(x,y){if(ghost){ghost.style.left=x+'px';ghost.style.top=y+'px';}bin.classList.toggle('is-over',overBin(x,y));}
  document.addEventListener('pointermove',event=>{
    if(!touch||event.pointerId!==touch.id)return;
    if(!touch.active){if(Math.hypot(event.clientX-touch.x,event.clientY-touch.y)>12)clearDrag();return;}
    event.preventDefault();moveGhost(event.clientX,event.clientY);
  },{passive:false});
  document.addEventListener('pointerup',event=>{
    if(!touch||event.pointerId!==touch.id)return;const dropping=touch.active&&overBin(event.clientX,event.clientY),id=activeId;
    if(touch.active){event.preventDefault();suppressClickUntil=Date.now()+500;suppressBinClickUntil=Date.now()+150;}clearDrag();if(dropping&&id)change('moveToTrash',id);
  });
  document.addEventListener('pointercancel',event=>{if(touch&&event.pointerId===touch.id)clearDrag();});
  root.addEventListener('contextmenu',event=>{if(touch?.active)event.preventDefault();});
  window.addEventListener('blur',clearDrag);window.addEventListener('pagehide',clearDrag);
  window.addEventListener('storage',event=>{if(event.key===libraryKey||event.key===legacySitesKey||event.key===null)refresh();});
  try{render(library.read());}catch(error){void showError(error);}
  return {refresh:render};
}
