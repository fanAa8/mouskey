const assert=require('assert');const path=require('path');const fs=require('fs');const os=require('os')
const br=require(path.join(__dirname,'..','electron','battlerite.cjs'))
let pass=0,fail=0;const t=(n,f)=>{try{f();pass++;console.log('ok',n)}catch(e){fail++;console.log('FAIL',n,e.message)}}
t('defaults fill {}',()=>{const o=JSON.parse(br.withDefaults('KMInput.json','{}'));assert.deepStrictEqual(o['Move.Y.Pos'],['k.W']);assert.deepStrictEqual(o.Ability4,['k.Q'])})
t('existing overrides kept',()=>{const o=JSON.parse(br.withDefaults('KMInput.json','{"Ability4":[],"Move.Y.Pos":["k.Up"]}'));assert.deepStrictEqual(o.Ability4,[]);assert.deepStrictEqual(o['Move.Y.Pos'],['k.Up'])})
t('other files untouched',()=>assert.strictEqual(br.withDefaults('settings.json','{}'),'{}'))
t('utf16 no-BOM roundtrip',()=>{const b=Buffer.from('{}','utf16le');const d=br.decode(b);assert.strictEqual(d.encoding,'utf16le');assert.strictEqual(d.bom,false);assert(br.encode('{}',d).equals(b))})
t('appId',()=>assert.strictEqual(br.appIdFromGameId('unity-504370'),'504370'))
t('mirror only when matching',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'brt'));const r=path.join(root,'userdata','1','504370','remote');fs.mkdirSync(r,{recursive:true});
 fs.writeFileSync(path.join(r,'KMInput'),Buffer.from('{ }','utf16le'))
 const dry=br.mirrorToCloud({steamPath:root,appId:'504370',fileName:'KMInput.json',origText:'{}',newText:'{"a":1}',dryRun:true});assert.strictEqual(dry.length,1);assert(dry[0].dryRun)
 const sk=br.mirrorToCloud({steamPath:root,appId:'504370',fileName:'KMInput.json',origText:'{"x":1}',newText:'{}',dryRun:true});assert(sk[0].skipped)})
console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0)
