// Keep the native select as the form/state source; render a consistent, accessible menu.
const chevron='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg>';
const check='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>';
export function enhanceSelects(selects) {
  const menus=[];let current;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  for(const select of selects) {
    const root=document.createElement('div'),trigger=document.createElement('button'),value=document.createElement('span'),menu=document.createElement('div');
    root.className='select-menu';trigger.className='select-menu__trigger';value.className='select-menu__value';menu.className='select-menu__options';
    trigger.type='button';trigger.id=select.id+'-trigger';menu.id=select.id+'-listbox';menu.hidden=true;
    trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',menu.id);
    menu.setAttribute('role','listbox');
    const label=select.getAttribute('aria-label')||Array.from(select.labels??[]).map(node=>node.textContent.trim()).join(' ')||'选择';
    trigger.setAttribute('aria-label',label);menu.setAttribute('aria-label',label);
    for(const label of Array.from(select.labels??[]))if(label.htmlFor===select.id)label.htmlFor=trigger.id;
    const icon=document.createElement('span');icon.className='select-menu__chevron';icon.innerHTML=chevron;trigger.append(value,icon);
    select.before(root);root.append(trigger,select,menu);select.hidden=true;select.tabIndex=-1;
    const topLayer=typeof menu.showPopover==='function';if(topLayer)menu.setAttribute('popover','manual');
    else (select.closest('dialog')??document.body).append(menu);
    let items=[],active=-1,expanded=false,animation,search='',searchTimer;
    const available=()=>items.map((item,index)=>item.disabled?-1:index).filter(index=>index>=0);
    function stop(){animation?.cancel();animation=undefined;}
    function animate(open) {
      stop();if(reduced.matches||typeof menu.animate!=='function'){if(!open)hide();return;}
      const off={opacity:0,transform:`translateY(${menu.dataset.side==='above'?5:-5}px) scale(.98)`},on={opacity:1,transform:'translateY(0) scale(1)'};
      const next=menu.animate(open?[off,on]:[on,off],{duration:open?170:120,easing:'cubic-bezier(.22,.61,.36,1)',fill:'both'});animation=next;
      next.finished.then(()=>{if(animation!==next)return;animation=undefined;if(!open)hide();next.cancel();}).catch(()=>{});
    }
    function hide(){if(topLayer&&menu.matches(':popover-open'))menu.hidePopover();menu.hidden=true;}
    function close({immediate=false}={}) {
      if(!expanded){if(immediate){stop();hide();}return;}
      expanded=false;trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-activedescendant');menu.inert=true;
      if(current===controller)current=undefined;
      clearTimeout(searchTimer);search='';if(immediate){stop();hide();}else animate(false);
    }
    function setActive(index) {
      active=index;items.forEach((item,i)=>item.node.classList.toggle('is-active',i===index));
      if(expanded&&items[index]){trigger.setAttribute('aria-activedescendant',items[index].node.id);items[index].node.scrollIntoView({block:'nearest'});}
    }
    function position() {
      const rect=trigger.getBoundingClientRect(),viewport=window.visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
      const below=top+height-rect.bottom-12,above=rect.top-top-12,up=below<Math.min(menu.scrollHeight,180)&&above>below;
      const menuWidth=Math.min(Math.max(rect.width,180),width-20),limit=Math.max(40,Math.min(280,up?above:below));
      menu.dataset.side=up?'above':'below';menu.style.width=menuWidth+'px';menu.style.maxHeight=limit+'px';
      menu.style.left=Math.max(left+10,Math.min(rect.left,left+width-menuWidth-10))+'px';
      menu.style.top=(up?Math.max(top+10,rect.top-6-Math.min(menu.scrollHeight,limit)):rect.bottom+6)+'px';
    }
    function open() {
      if(select.disabled)return;current?.close({immediate:true});stop();refresh();expanded=true;current=controller;
      trigger.setAttribute('aria-expanded','true');menu.hidden=false;menu.inert=false;if(topLayer&&!menu.matches(':popover-open'))menu.showPopover();
      position();setActive(items[select.selectedIndex]?.disabled?available()[0]??-1:select.selectedIndex);animate(true);
    }
    function choose(index) {
      const item=items[index];if(!item||item.disabled)return;
      const changed=select.selectedIndex!==index;select.selectedIndex=index;refresh();close();trigger.focus({preventScroll:true});
      if(changed){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
    }
    function refresh() {
      value.textContent=select.selectedOptions[0]?.label??'选择';trigger.disabled=select.disabled;
      if(select.disabled)close({immediate:true});
      const before=active;
      items=Array.from(select.options).map((option,index)=>{
        const node=document.createElement('div'),text=document.createElement('span'),mark=document.createElement('span');
        node.className='select-menu__option';node.id=select.id+'-option-'+index;node.setAttribute('role','option');node.setAttribute('aria-selected',String(option.selected));node.setAttribute('aria-disabled',String(option.disabled));
        text.className='select-menu__option-text';text.textContent=option.label;mark.className='select-menu__check';mark.innerHTML=check;node.append(text,mark);
        node.addEventListener('click',()=>choose(index));node.addEventListener('pointermove',event=>{if(event.pointerType==='mouse'&&!option.disabled)setActive(index);});
        node.addEventListener('mousedown',event=>event.preventDefault());
        return {node,disabled:option.disabled,label:option.label};
      });
      menu.replaceChildren(...items.map(item=>item.node));
      if(expanded){position();setActive(Math.min(before,items.length-1));}
    }
    function move(step) {
      const indices=available();if(!indices.length)return;
      const index=indices.indexOf(active);setActive(indices[(index+step+indices.length)%indices.length]);
    }
    trigger.addEventListener('click',()=>expanded?close():open());
    trigger.addEventListener('keydown',event=>{
      if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)) {
        event.preventDefault();
        if(!expanded){open();if(event.key==='Home')setActive(available()[0]??-1);else if(event.key==='End')setActive(available().at(-1)??-1);return;}
        if(event.key==='ArrowDown')move(1);else if(event.key==='ArrowUp')move(-1);else if(event.key==='Home')setActive(available()[0]??-1);else if(event.key==='End')setActive(available().at(-1)??-1);else choose(active);
      }else if(event.key==='Escape'&&expanded){event.preventDefault();event.stopPropagation();close();}
      else if(event.key==='Tab')close({immediate:true});
      else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey) {
        event.preventDefault();if(!expanded)open();clearTimeout(searchTimer);search+=event.key.toLocaleLowerCase();
        const match=items.findIndex(item=>!item.disabled&&item.label.toLocaleLowerCase().startsWith(search));if(match>=0)setActive(match);
        searchTimer=setTimeout(()=>{search='';},650);
      }
    });
    select.addEventListener('change',refresh);
    new MutationObserver(refresh).observe(select,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','selected','label']});
    const controller={root,trigger,menu,refresh,close};menus.push(controller);refresh();
    select.closest('dialog')?.addEventListener('close',()=>close({immediate:true}));
  }
  const containsTarget=target=>current&&(current.root.contains(target)||current.menu.contains(target));
  document.addEventListener('pointerdown',event=>{if(current&&!containsTarget(event.target))current.close();},true);
  document.addEventListener('focusin',event=>{if(current&&!containsTarget(event.target))current.close();});
  const closeAll=()=>menus.forEach(menu=>menu.close({immediate:true}));
  window.addEventListener('resize',closeAll);window.visualViewport?.addEventListener('resize',closeAll);
  document.addEventListener('scroll',event=>{if(current&&!current.menu.contains(event.target))current.close({immediate:true});},true);
  reduced.addEventListener('change',closeAll);
  return {refresh:()=>menus.forEach(menu=>menu.refresh()),close:closeAll};
}
