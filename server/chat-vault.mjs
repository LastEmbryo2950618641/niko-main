import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const deepseekProfile = Object.freeze({ id:'deepseek', name:'DeepSeek', provider:'deepseek', protocol:'openai', baseUrl:'https://api.deepseek.com/v1', model:'deepseek-flash', apiKey:'' });
const initialState = () => ({ activeProfileId:'deepseek', profiles:[{...deepseekProfile}] });

export class ChatVault {
  constructor(directory) { this.directory=directory; this.pending=new Map(); }
  async initialize() {
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const path=join(this.directory,'master.key');
    try { await writeFile(path,randomBytes(32),{flag:'wx',mode:0o600}); } catch(error) { if(error.code!=='EEXIST') throw error; }
    this.key=await readFile(path);
    if(this.key.length!==32) throw new Error('Invalid chat vault key');
  }
  filename(session) {
    if(!/^[a-f0-9]{64}$/.test(session)) throw new Error('Invalid chat session');
    return join(this.directory,createHash('sha256').update(session).digest('hex')+'.vault');
  }
  async read(session) {
    let encrypted;
    try { encrypted=await readFile(this.filename(session)); } catch(error) { if(error.code==='ENOENT') return initialState(); throw error; }
    if(encrypted.length<29||encrypted[0]!==1) throw new Error('Invalid chat vault');
    const decipher=createDecipheriv('aes-256-gcm',this.key,encrypted.subarray(1,13));
    decipher.setAAD(Buffer.from(session));
    decipher.setAuthTag(encrypted.subarray(13,29));
    return JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(29)),decipher.final()]).toString('utf8'));
  }
  async update(session,change) {
    const previous=this.pending.get(session)??Promise.resolve();
    const next=previous.catch(()=>{}).then(async()=>{
      const state=await this.read(session);
      const result=await change(state);
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);
      cipher.setAAD(Buffer.from(session));
      const ciphertext=Buffer.concat([cipher.update(JSON.stringify(state),'utf8'),cipher.final()]);
      const target=this.filename(session),temporary=target+'.'+randomBytes(6).toString('hex')+'.tmp';
      await writeFile(temporary,Buffer.concat([Buffer.from([1]),iv,cipher.getAuthTag(),ciphertext]),{mode:0o600,flag:'wx'});
      await rename(temporary,target);
      return result;
    });
    this.pending.set(session,next);
    try { return await next; } finally { if(this.pending.get(session)===next) this.pending.delete(session); }
  }
}

export function publicSettings(state) {
  return { activeProfileId:state.activeProfileId, profiles:state.profiles.map(({apiKey,...profile})=>({...profile,hasApiKey:Boolean(apiKey)})) };
}
