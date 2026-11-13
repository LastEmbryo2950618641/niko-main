import {normalizeSiteIcon} from './site-icon-catalog.js?v=1';

export function normalizeSiteUrl(value) {
  if(typeof value!=='string'||!value.trim()||value.length>2048)throw new Error('请填写有效的网址');
  const input=value.trim();let url;
  try{url=new URL(input.includes('://')?input:'https://'+input);}catch{throw new Error('请填写有效的网址');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!url.hostname)throw new Error('网址需要使用 HTTP 或 HTTPS，且不能包含账号密码');
  return url.href;
}
export function normalizeSiteDetails(value) {
  if(!value||typeof value!=='object'||typeof value.name!=='string'||!value.name.trim()||value.name.trim().length>40)throw new Error('名称需要填写 1–40 个字符');
  if(typeof value.note!=='string'||value.note.trim().length>60)throw new Error('简介不能超过 60 个字符');
  return {name:value.name.trim(),url:normalizeSiteUrl(value.url),note:value.note.trim(),icon:normalizeSiteIcon(value.icon)};
}
export function configuredSiteProfile(settings) {
  const profiles=settings?.profiles??[];
  return profiles.find(p=>p.id===settings.activeProfileId&&p.hasApiKey)||profiles.find(p=>p.hasApiKey)||null;
}
