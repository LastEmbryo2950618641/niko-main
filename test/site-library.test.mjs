import assert from 'node:assert/strict';
import test from 'node:test';
import {createSiteLibrary,libraryKey,legacySitesKey} from '../site-library.js';

const defaults=[{id:'default:one',name:'内置网站',url:'https://example.com',note:'原说明',charm:'moon-stars'}];
function fixture(legacy){
  const values=new Map(legacy?[[legacySitesKey,JSON.stringify(legacy)]]:[]);let sequence=0;
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  return {values,storage,library:createSiteLibrary({storage,defaults,uuid:()=>String(++sequence),now:()=>12345})};
}
const site=(name='新增网站')=>({name,url:'https://example.com/'+encodeURIComponent(name),note:'保存简介',charm:'butterfly'});

test('legacy sites load without a write and migrate into one atomic library record on a change',()=>{
  const old=[site('第一个'),site('第二个')],{library,values}=fixture(old);
  const before=library.read();assert.equal(values.has(libraryKey),false);assert.deepEqual(before.sites.map(s=>s.name),['第一个','第二个']);
  const after=library.moveToTrash(before.sites[0].id);assert.equal(after.sites.length,1);assert.equal(after.trash.length,1);assert.deepEqual(library.read(),after);
  assert.equal(values.get(legacySitesKey),JSON.stringify(old));
});
test('custom sites retain independent identities, metadata and original order through trash and restoration',()=>{
  const {library}=fixture();library.add(site('同名'));library.add(site('同名'));library.add(site('末尾'));
  const [a,b,c]=library.read().sites;assert.notEqual(a.id,b.id);
  library.moveToTrash(a.id);library.moveToTrash(b.id);library.restore(b.id);library.restore(a.id);
  assert.deepEqual(library.read().sites,[a,b,c]);assert.equal(library.read().trash.length,0);
});
test('built-in cards restore once, and permanent removal stays hidden after reload',()=>{
  const {library,storage}=fixture();library.moveToTrash(defaults[0].id);library.moveToTrash(defaults[0].id);
  assert.equal(library.read().trash.length,1);assert.deepEqual(library.read().hiddenDefaults,['default:one']);
  library.restore('default:one');assert.deepEqual(library.read().hiddenDefaults,[]);
  library.moveToTrash('default:one');library.removeForever('default:one');
  const reloaded=createSiteLibrary({storage,defaults});assert.deepEqual(reloaded.read().hiddenDefaults,['default:one']);assert.equal(reloaded.read().trash.length,0);
});
test('a custom site permanently deleted from trash never reappears from legacy migration',()=>{
  const {library,storage}=fixture([site()]);const id=library.read().sites[0].id;library.moveToTrash(id);library.removeForever(id);
  const reloaded=createSiteLibrary({storage,defaults});assert.equal(reloaded.read().sites.length,0);assert.equal(reloaded.read().trash.length,0);
});
test('storage failures preserve both the previous list and its recoverable trash',()=>{
  const {library,storage,values}=fixture();library.add(site());const id=library.read().sites[0].id,before=values.get(libraryKey),write=storage.setItem;
  storage.setItem=()=>{throw new Error('QuotaExceeded');};assert.throws(()=>library.moveToTrash(id),/无法保存/);assert.equal(values.get(libraryKey),before);
  storage.setItem=write;library.moveToTrash(id);const moved=values.get(libraryKey);storage.setItem=()=>{throw new Error('QuotaExceeded');};
  assert.throws(()=>library.restore(id),/无法保存/);assert.throws(()=>library.removeForever(id),/无法保存/);assert.equal(values.get(libraryKey),moved);
});
test('unreadable data and malformed records fail without overwriting the original value',()=>{
  const {library,values}=fixture();
  for(const value of ['broken',JSON.stringify({version:2}),JSON.stringify({version:1,sites:[],hiddenDefaults:[],trash:[{...site(),id:'one',order:0,kind:'default',deletedAt:1}]})]){
    values.set(libraryKey,value);assert.throws(()=>library.add(site()),/无法读取/);assert.equal(values.get(libraryKey),value);
  }
});
test('every mutation reads current browser state so another tab cannot be overwritten by an old in-memory list',()=>{
  const {library,storage}=fixture(),other=createSiteLibrary({storage,defaults,uuid:()=> 'other'});
  library.read();other.add(site('另一个标签页'));library.moveToTrash('default:one');
  assert.equal(library.read().sites[0].name,'另一个标签页');other.restore('default:one');assert.equal(library.read().trash.length,0);
});
test('a removed built-in template can still be restored as a normal website',()=>{
  const {library,storage}=fixture();library.moveToTrash('default:one');
  const newer=createSiteLibrary({storage,defaults:[],uuid:()=> 'restored'}),state=newer.restore('default:one');
  assert.equal(state.sites.length,1);assert.equal(state.sites[0].name,'内置网站');assert.equal(state.sites[0].id,'custom:restored');
});

test('AI-selected icons persist through saving, reload, trash and restoration while old sites keep their default icon',()=>{
  const {library,storage}=fixture([site('旧网站')]);assert.equal(library.read().sites[0].icon,'bookmark-simple');
  library.add({...site('绘画网站'),icon:'palette'});const selected=library.read().sites[1];assert.equal(selected.icon,'palette');
  library.moveToTrash(selected.id);const reloaded=createSiteLibrary({storage,defaults});assert.equal(reloaded.read().trash[0].icon,'palette');
  reloaded.restore(selected.id);assert.equal(reloaded.read().sites[1].icon,'palette');
});
