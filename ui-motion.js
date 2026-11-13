const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const ease='cubic-bezier(.22,.61,.36,1)';
const canAnimate=()=>!reducedMotion.matches&&typeof Element.prototype.animate==='function';
const frame=(y,opacity=1)=>({transform:`translate3d(0,${y}px,0)`,opacity});

function snapshot(node){
  if(!node.getClientRects().length)return null;
  const style=getComputedStyle(node);
  return {rect:node.getBoundingClientRect(),display:style.display,opacity:Number(style.opacity),transform:style.transform};
}
function freeze(node,box){
  const original=node.style.cssText;
  Object.assign(node.style,{display:box.display,position:'fixed',left:box.rect.left+'px',top:box.rect.top+'px',width:box.rect.width+'px',height:box.rect.height+'px',maxHeight:'none',margin:'0',flex:'none',zIndex:'1',pointerEvents:'none'});
  return ()=>{node.style.cssText=original;};
}

export function createChatTransition(panel,toggle){
  const shelf=panel.closest('.shelf'),toolbar=shelf.querySelector('.toolbar'),stage=document.getElementById('shelf-stage'),pagination=document.getElementById('pagination');
  let running,revision=0;
  function stop(){
    if(!running)return;
    running.animations.forEach(animation=>animation.cancel());
    running.restore.forEach(restore=>restore());
    running=undefined;
  }
  function settle(){
    revision++;stop();
    const open=toggle.getAttribute('aria-expanded')==='true';
    shelf.classList.toggle('is-chat-open',open);panel.hidden=!open;
    panel.inert=stage.inert=pagination.inert=false;
    delete shelf.dataset.switching;
  }
  window.addEventListener('resize',settle);
  reducedMotion.addEventListener('change',settle);
  return async open=>{
    // Read current visual positions before interrupting a previous transition.
    const before=new Map([toolbar,stage,pagination,panel].map(node=>[node,snapshot(node)]));
    const ticket=++revision;stop();toggle.setAttribute('aria-expanded',String(open));
    if(!canAnimate()){
      settle();if(!open)window.dispatchEvent(new Event('resize'));return;
    }
    const outgoing=open?[stage,pagination]:[panel],incoming=open?[panel]:[stage,pagination];
    const restore=outgoing.filter(node=>before.get(node)).map(node=>freeze(node,before.get(node)));
    shelf.classList.toggle('is-chat-open',open);panel.hidden=false;
    panel.inert=!open;stage.inert=pagination.inert=open;
    shelf.dataset.switching='true';
    // Rebuild responsive pages once the incoming home view has its normal layout.
    if(!open)window.dispatchEvent(new CustomEvent('shelf:layout'));
    const animations=[],options={duration:520,easing:ease,fill:'both'};
    for(const node of outgoing){
      const box=before.get(node);if(!box)continue;
      const distance=open?Math.max(32,innerHeight-box.rect.top+24):-Math.max(32,box.rect.bottom+24);
      animations.push(node.animate([frame(0,box.opacity),frame(distance,0)],options));
    }
    for(const node of incoming){
      const after=snapshot(node);if(!after)continue;
      const previous=before.get(node);
      const distance=previous?previous.rect.top-after.rect.top:open?-after.rect.bottom-24:innerHeight-after.rect.top+24;
      animations.push(node.animate([frame(distance,previous?.opacity??0),frame(0)],options));
    }
    const toolbarBefore=before.get(toolbar),toolbarAfter=snapshot(toolbar);
    if(toolbarBefore&&toolbarAfter)animations.push(toolbar.animate([frame(toolbarBefore.rect.top-toolbarAfter.rect.top),frame(0)],options));
    running={animations,restore};
    await Promise.all(animations.map(animation=>animation.finished.catch(()=>{})));
    if(ticket!==revision)return;
    stop();panel.hidden=!open;panel.inert=stage.inert=pagination.inert=false;delete shelf.dataset.switching;
  };
}

const popovers=new WeakMap();
export function setPopoverOpen(node,open){
  if(node.dataset.expanded===String(open))return;
  const previous=popovers.get(node),before=snapshot(node);
  previous?.cancel();node.dataset.expanded=String(open);node.inert=!open;node.setAttribute('aria-hidden',String(!open));
  if(!canAnimate()||(!open&&!before)){node.hidden=!open;return;}
  node.hidden=false;
  const y=previous&&before&&before.transform!=='none'?new DOMMatrix(before.transform).m42:open?-10:0;
  const animation=node.animate([frame(y,before?.opacity??0),frame(open?0:-10,open?1:0)],{duration:open?220:160,easing:ease,fill:'both'});
  popovers.set(node,animation);
  animation.finished.then(()=>{if(popovers.get(node)!==animation)return;node.hidden=!open;popovers.delete(node);animation.cancel();}).catch(()=>{});
}

const dialogs=new WeakMap(),wiredDialogs=new WeakSet();
function dialogMotion(node,closing){
  const previous=dialogs.get(node),style=previous?getComputedStyle(node):null;
  const from=style?{transform:style.transform,opacity:style.opacity}:null;
  previous?.cancel();
  if(closing&&!node.open)return Promise.resolve();
  if(!closing&&!node.open)node.showModal();
  node.toggleAttribute('data-closing',closing);
  if(!canAnimate()){if(closing)node.close();node.removeAttribute('data-closing');return Promise.resolve();}
  const sheet=node.classList.contains('api-dialog')&&matchMedia('(max-width:639px)').matches;
  const off={transform:sheet?'translate3d(0,100%,0)':'translate3d(0,18px,0) scale(.97)',opacity:0};
  const on={transform:'translate3d(0,0,0) scale(1)',opacity:1};
  const animation=node.animate([from??(closing?on:off),closing?off:on],{duration:closing?180:280,easing:ease,fill:'both'});
  dialogs.set(node,animation);
  return animation.finished.then(()=>{
    if(dialogs.get(node)!==animation)return;
    dialogs.delete(node);if(closing)node.close();node.removeAttribute('data-closing');animation.cancel();
  }).catch(()=>{});
}
export function showDialog(node){
  if(!wiredDialogs.has(node)){
    node.addEventListener('cancel',event=>{event.preventDefault();void hideDialog(node);});wiredDialogs.add(node);
  }
  return dialogMotion(node,false);
}
export function hideDialog(node){return dialogMotion(node,true);}
