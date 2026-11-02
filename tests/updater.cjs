const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
async function scenario({version='0.6.0', fail=false, missing=false, incompatible=false}={}) {
  const notices=[], errors=[], writes=[];
  const dir='.obsidian/plugins/cover-banner';
  const names=['main.js','styles.css','manifest.json'];
  const disk=Object.fromEntries(names.map(n=>[`${dir}/${n}`, n==='manifest.json'?JSON.stringify({id:'cover-banner',version:'0.5.8'}):`old ${n}`]));
  disk[`${dir}/data.json`]='private settings';
  const original={...disk};
  const manifest={id:'cover-banner',version,minAppVersion: incompatible?'9.0.0':'1.4.0'};
  const prefix='https://github.com/frimpsjoek/cover-banner/releases/download/test/';
  const release={tag_name:version,assets:names.filter(n=>!missing||n!=='styles.css').map(name=>({name,browser_download_url:prefix+name}))};
  const obsidian={Plugin:class{},PluginSettingTab:class{},Modal:class{},ItemView:class{},apiVersion:'1.8.0',Notice:class{constructor(m){notices.push(m)}},requestUrl:async({url})=>url.endsWith('/latest')?{json:release}:{text:url.endsWith('manifest.json')?JSON.stringify(manifest):`new ${url.split('/').pop()}`}};
  const ctx={module:{exports:{}},require:()=>obsidian,console:{error:(...e)=>errors.push(e)}};
  vm.runInNewContext(readFileSync('main.js','utf8'),ctx);
  const p=new ctx.module.exports(); p.manifest={id:'cover-banner',version:'0.5.8',dir};
  let failed=false;
  p.app={vault:{adapter:{read:async path=>disk[path],write:async(path,value)=>{
    writes.push(path);
    if(fail&&!failed&&path===`${dir}/styles.css`){failed=true;disk[path]='partial';throw Error('write failure');}
    disk[path]=value;
  }}}};
  await p.checkForUpdates(true);
  assert.equal(p._updating,false);
  assert.equal(disk[`${dir}/data.json`],'private settings');
  if(fail||missing||incompatible||version==='invalid'||version==='0.5.8'||version==='0.5.5') {
    for(const n of names) assert.equal(disk[`${dir}/${n}`],original[`${dir}/${n}`]);
  } else {
    assert.equal(JSON.parse(disk[`${dir}/manifest.json`]).version,version);
    for(const n of names) assert.equal(disk[`${dir}/${n}.update-backup`],original[`${dir}/${n}`]);
    assert.match(notices.at(-1),/Restart Obsidian/);
  }
  if(missing||incompatible) assert.equal(writes.length,0);
}
(async()=>{
 for(const options of [{},{version:'0.5.8'},{version:'0.5.5'},{fail:true},{missing:true},{incompatible:true},{version:'invalid'}]) await scenario(options);
 console.log('PASS: install, current version, downgrade prevention, partial-write rollback, missing assets, compatibility, settings preservation');
})().catch(e=>{console.error(e);process.exitCode=1;});
