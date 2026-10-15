process.env.MOUSKEY_TARGETS_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'mk-targets-'))
const assert=require('assert');const path=require('path');const fs=require('fs');const os=require('os')
const L=require(path.join(__dirname,'..','electron','lol-abilities.cjs'))
let pass=0,fail=0;const t=async(n,f)=>{try{await f();pass++;console.log('ok',n)}catch(e){fail++;console.log('FAIL',n,e.message)}}
const cur={evtCastSpell1:'[q]',evtCastSpell2:'[w]',evtCastSpell3:'[e]',evtCastSpell4:'[r]',evtSmartCastSpell1:'[Shift][q]',evtSmartCastSpell2:'[Shift][w]',evtSmartCastSpell3:'[Shift][e]',evtSmartCastSpell4:'[Shift][r]',evtSelfCastSpell1:'[Alt][q],',evtSelfCastSpell2:'[Alt][w],',evtSelfCastSpell3:'[Alt][e],',evtSelfCastSpell4:'[<Unbound>]',evtLevelSpell1:'[Ctrl][q],[Alt][Button 2]',evtLevelSpell2:'[Ctrl][w],[Alt][a]',evtLevelSpell3:'[Ctrl][e],[Alt][Space]',evtLevelSpell4:'[Ctrl][r],[Alt][r]',evtRadialEmoteInstantOpen:'[t]',evtCastAvatarSpell1:'[d]'}
;(async()=>{
await t('plan has 16 updates',()=>{const p=L.planWert(cur);assert.strictEqual(Object.keys(p.updates).length,16);assert.strictEqual(p.conflicts.length,0);assert.strictEqual(p.updates.evtLevelSpell4,'[Ctrl][t],[Alt][t]')})
await t('no collisions after plan',()=>{const after={...cur,...L.planWert(cur).updates};const seen={};for(const v of Object.values(after))for(const k of v.split(',').filter(x=>x&&x!=='[<Unbound>]')){assert(!seen[k],'dup '+k);seen[k]=1}})
await t('idempotent',()=>{const p=L.planWert({...cur,...L.planWert(cur).updates});assert.strictEqual(Object.keys(p.updates).length,0);assert.strictEqual(p.already.length,16)})
await t('conflict blocks',()=>{const p=L.planWert({...cur,evtCastSpell1:'[z]'});assert.strictEqual(p.conflicts.length,1)})
await t('game running blocks',async()=>{const r=await L.applyLolAbilitiesWert({isGameRunning:()=>true,findLcuApi:()=>null},{});assert.strictEqual(r.status,'game-running')})
await t('client missing → no write',async()=>{const r=await L.applyLolAbilitiesWert({isGameRunning:()=>false,findLcuApi:()=>null},{});assert.strictEqual(r.status,'client-not-running')})
await t('mock LCU full flow + files',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lol'));const ps=path.join(dir,'PersistedSettings.json'),ini=path.join(dir,'input.ini')
 fs.writeFileSync(ps,JSON.stringify({files:[{name:'Input.ini',sections:[{name:'GameEvents',settings:Object.entries(cur).map(([name,value])=>({name,value}))},{name:'WASD',settings:[{name:'MoveUp',value:'[e]'}]}]}]}))
 fs.writeFileSync(ini,'[GameEvents]\r\nevtCastSpell1=[q]\r\n[WASD]\r\nMoveUp=[e]\r\n')
 let state={GameEvents:{...cur},WASD:{MoveUp:'[e]'}}
 const req=async(port,auth,m,p,body)=>{if(p.includes('gameflow'))return{status:200,data:'"None"'};if(m==='GET')return{status:200,data:JSON.stringify(state)};if(m==='PATCH'){const b=JSON.parse(body);state={...state,GameEvents:{...state.GameEvents,...b.GameEvents}};return{status:204,data:''}}return{status:204,data:''}}
 const r=await L.applyLolAbilitiesWert({isGameRunning:()=>false,findLcuApi:()=>({port:1,token:'x'}),lcuRequest:req,buildLolCandidates:()=>[{persistedSettingsPath:ps,inputPath:ini}]},{})
 assert(r.success&&r.lcuVerified&&r.wasdUntouched,JSON.stringify(r));assert(r.files.every(f=>f.verified),JSON.stringify(r.files))
 assert(fs.readFileSync(ini,'utf8').includes('MoveUp=[e]'));assert(fs.readFileSync(ini,'utf8').includes('evtCastSpell1=[w]'))
 for(const f of r.files)fs.rmSync(f.backup);fs.rmSync(r.lcuBackup)})
await t('game.cfg click-move edit',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lolg'));const g=path.join(dir,'game.cfg');fs.writeFileSync(g,'[General]\r\nCameraModeWASD=1\r\nWASD=1\r\n[HUD]\r\nMovement Mode=1\r\n');const r=L.setGameCfgVerified(g,L.CLICK_MOVE,dir);assert(r.verified,JSON.stringify(r));const x=fs.readFileSync(g,'utf8');assert(x.includes('WASD=0')&&x.includes('Movement Mode=0')&&x.includes('\r\n'))})
console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0)})()
