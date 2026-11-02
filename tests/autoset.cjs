const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const obsidian={Plugin:class{},PluginSettingTab:class{},Modal:class{},ItemView:class{},Notice:class{}};
const ctx={module:{exports:{}},require:()=>obsidian,URL};vm.createContext(ctx);vm.runInContext(fs.readFileSync('main.js','utf8'),ctx);
for(const html of [
 '<meta data-extra="x" content="/photo.jpg?a=1&amp;b=2" property="og:image">',
 "<META PROPERTY='og:image' data-extra='x' CONTENT='/photo.jpg?a=1&amp;b=2'>",
 '<meta name="twitter:image:src" content="/photo.jpg?a=1&amp;b=2">']) {
 ctx.html=html;assert.equal(vm.runInContext('pickOgImage(html,"https://example.com/post")',ctx),'https://example.com/photo.jpg?a=1&b=2');
}
(async()=>{
 const p=new ctx.module.exports(), file={path:'note.md',basename:'note'};
 p.settings={defaultBanner:'https://example.com/default.jpg',bannerFolder:'banners'};
 p.getFrontmatterSafe=()=>({});p.getBannerValueFromFrontmatter=()=>null;p.findUrlInFrontmatter=()=>null;
 p.autoSetFromGoogleBooks=async()=>false;p.resolveBannerValueToSrc=(_,v)=>v;
 let selected; p.setFrontmatterPrimary=async(_,v)=>{selected=v;};
 assert.equal(await p.autoSetForFile(file,{force:true,createEmptyOnFail:true}),true);assert.equal(selected,p.settings.defaultBanner);
 p.settings.defaultBanner='';let written;
 p.app={vault:{getAbstractFileByPath:()=>({}),adapter:{exists:async()=>false,write:async(path,content)=>{written={path,content};}}}};
 assert.equal(await p.autoSetForFile(file,{force:true,createEmptyOnFail:false}),true);
 assert.equal(selected,'[[banners/default-landscape.svg]]');assert.match(written.content,/<svg/);
 p.getBannerValueFromFrontmatter=()=> 'existing.jpg';selected=null;
 assert.equal(await p.autoSetForFile(file,{force:false,createEmptyOnFail:false}),false);assert.equal(selected,null);
 console.log('PASS: flexible metadata, entity decoding, configured fallback, offline fallback, existing banner preservation');
})().catch(e=>{console.error(e);process.exitCode=1;});
