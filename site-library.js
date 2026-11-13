import {normalizeSiteDetails} from './site-details.js?v=2';

export const libraryKey='site-shelf.library.v1';
export const legacySitesKey='site-shelf.custom-sites.v1';
const siteData=value=>({...normalizeSiteDetails({...value,note:value.note??''}),charm:typeof value.charm==='string'?value.charm:''});
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=2048;
export function createSiteLibrary({storage={getItem:key=>globalThis.localStorage.getItem(key),setItem:(key,value)=>globalThis.localStorage.setItem(key,value)},defaults=[],uuid=()=>globalThis.crypto.randomUUID(),now=()=>Date.now()}={}) {
  const builtins=new Map(defaults.map(site=>[site.id,siteData(site)]));
  function read(){
    let raw,legacy;
    try{raw=storage.getItem(libraryKey);if(!raw)legacy=storage.getItem(legacySitesKey);}catch{throw new Error('无法读取网站列表与回收站，请检查浏览器存储权限');}
    try{
      if(!raw){
        const old=legacy?JSON.parse(legacy):[];if(!Array.isArray(old))throw new Error();
        const sites=old.map((site,index)=>({...siteData(site),id:`legacy:${index}`,order:index}));
        return {version:1,sites,hiddenDefaults:[],trash:[],nextOrder:sites.length};
      }
      const state=JSON.parse(raw);
      if(state?.version!==1||!Array.isArray(state.sites)||!Array.isArray(state.trash)||!Array.isArray(state.hiddenDefaults)||!state.hiddenDefaults.every(validId))throw new Error();
      const ids=new Set();
      const record=value=>{
        if(!validId(value.id)||ids.has(value.id)||!Number.isSafeInteger(value.order)||value.order<0)throw new Error();ids.add(value.id);
        return {...siteData(value),id:value.id,order:value.order};
      };
      const sites=state.sites.map(record).sort((a,b)=>a.order-b.order),hiddenDefaults=[...new Set(state.hiddenDefaults)];
      const trash=state.trash.map(item=>{
        if(!['default','custom'].includes(item.kind)||!Number.isFinite(item.deletedAt)||item.deletedAt<0)throw new Error();
        const value=record(item);if(item.kind==='default'&&!hiddenDefaults.includes(value.id))throw new Error();
        return {...value,kind:item.kind,deletedAt:item.deletedAt};
      });
      const orders=[...sites,...trash.filter(item=>item.kind==='custom')].map(item=>item.order+1);
      const nextOrder=Math.max(0,...orders,Number.isSafeInteger(state.nextOrder)&&state.nextOrder>=0?state.nextOrder:0);
      return {version:1,sites,hiddenDefaults,trash,nextOrder};
    }catch{throw new Error('本地网站列表或回收站数据无法读取，请检查浏览器数据');}
  }
  function update(change){
    const state=read();change(state);
    try{storage.setItem(libraryKey,JSON.stringify(state));}catch{throw new Error('无法保存网站列表与回收站，请检查浏览器存储权限或可用空间');}
    return state;
  }
  return {
    read,
    add:site=>update(state=>{state.sites.push({...siteData(site),id:`custom:${uuid()}`,order:state.nextOrder++});}),
    moveToTrash:id=>update(state=>{
      if(state.trash.some(item=>item.id===id))return;
      if(builtins.has(id)){
        if(state.hiddenDefaults.includes(id))return;
        state.hiddenDefaults.push(id);state.trash.push({...builtins.get(id),id,order:[...builtins.keys()].indexOf(id),kind:'default',deletedAt:now()});
      }else{
        const index=state.sites.findIndex(site=>site.id===id);if(index<0)throw new Error('该网站已不存在，请刷新后重试');
        const [site]=state.sites.splice(index,1);state.trash.push({...site,kind:'custom',deletedAt:now()});
      }
    }),
    restore:id=>update(state=>{
      const index=state.trash.findIndex(site=>site.id===id);if(index<0)throw new Error('回收站中已没有该网站');
      const {kind,deletedAt,...site}=state.trash.splice(index,1)[0];
      if(kind==='default'&&builtins.has(id))state.hiddenDefaults=state.hiddenDefaults.filter(key=>key!==id);
      else{
        state.sites.push(kind==='default'?{...site,id:`custom:${uuid()}`,order:state.nextOrder++}:site);
        state.sites.sort((a,b)=>a.order-b.order);
      }
    }),
    removeForever:id=>update(state=>{
      const index=state.trash.findIndex(site=>site.id===id);if(index<0)throw new Error('回收站中已没有该网站');
      state.trash.splice(index,1);
      // Keep hidden default IDs: permanent deletion must survive a reload.
    })
  };
}
