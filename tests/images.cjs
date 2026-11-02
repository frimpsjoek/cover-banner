const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const obsidian={Plugin:class{},PluginSettingTab:class{},Modal:class{},ItemView:class{}};
const ctx={module:{exports:{}},require:()=>obsidian,Blob};vm.createContext(ctx);
vm.runInContext(fs.readFileSync('main.js','utf8'),ctx);
const input=new ArrayBuffer(1000);ctx.input=input;
async function run(type){ctx.type=type;return vm.runInContext('optimizeBannerDownload(input,type)',ctx);}
(async()=>{
 assert.equal((await run('image/jpeg')).buffer,input); // Unsupported renderer preserves originals.
 let closed=0,canvas,draw;
 ctx.createImageBitmap=async()=>({width:4000,height:3000,close(){closed++;}});
 ctx.document={createElement:()=>canvas={getContext:()=>({drawImage(...args){draw=args;}}),toBlob:cb=>cb(new Blob([new Uint8Array(100)],{type:'image/webp'}))}};
 const optimized=await run('image/jpeg');
 assert.equal(optimized.contentType,'image/webp');assert.equal(optimized.buffer.byteLength,100);
 assert.equal(canvas.width,1333);assert.equal(canvas.height,1000);assert.equal(closed,1);assert.equal(draw.length,5);
 assert.equal((await run('image/gif')).buffer,input);assert.equal((await run('image/svg+xml')).buffer,input);
 ctx.document.createElement=()=>({getContext:()=>({drawImage(){}}),toBlob:cb=>cb(new Blob([new Uint8Array(2000)],{type:'image/webp'}))});
 assert.equal((await run('image/png')).buffer,input);
 ctx.createImageBitmap=async()=>{throw Error('invalid image');};assert.equal((await run('image/png')).buffer,input);
 console.log('PASS: resize bounds, aspect ratio, smaller WebP output, bitmap cleanup, animated/vector preservation, unsupported and failed conversion fallback');
})().catch(e=>{console.error(e);process.exitCode=1;});
