// People with no image API key must still get covers: built-in ones, offline, and a
// visible default if the default photo cannot load.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const js = fs.readFileSync('main.js', 'utf8');
const obsidian = {Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, ItemView: class {}, Notice: class {}};
const ctx = {module: {exports: {}}, require: () => obsidian, URL};
vm.createContext(ctx);
vm.runInContext(js, ctx);

const covers = vm.runInContext('BUILTIN_COVERS', ctx);
assert.ok(covers.length >= 6, 'expected a gallery of covers');
assert.equal(new Set(covers.map(c => c.id)).size, covers.length, 'cover ids must be unique');
for (const c of covers) {
  assert.match(c.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*viewBox="0 0 1600 600"/, c.id);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(c.svg), `${c.id} must not load anything from the network`);
  assert.ok(c.svg.endsWith('</svg>'), c.id);
}
ctx.cover = covers[0];
assert.match(vm.runInContext('svgDataUri(cover.svg)', ctx), /^data:image\/svg\+xml,%3Csvg/);

// The picker offers covers before the search that needs a key, and a missing key is
// explained in place instead of through an error toast.
const picker = js.slice(js.indexOf('class PexelsPickerModal'), js.indexOf('class IconPickerModal'));
assert.ok(picker.indexOf('renderBuiltinCovers') < picker.indexOf('Search Pexels with an API key'));
assert.ok(!picker.includes('set Pexels API key in plugin settings'), 'no-key search must not be an error toast');
assert.match(picker, /Add a Pexels API key/);

// Only a failed default falls back; a broken cover the user chose must stay visible as broken.
assert.match(js, /if \(!this\.getBannerValueFromFrontmatter\(fm\)\) img\.addEventListener\("error"/);

(async () => {
  const p = new ctx.module.exports(), writes = [];
  const files = new Set();
  p.app = {vault: {getAbstractFileByPath: () => null, createFolder: async () => {}, adapter: {
    exists: async path => files.has(path),
    mkdir: async () => {},
    write: async (path, data) => { files.add(path); writes.push([path, data]); },
  }}};
  p.settings = {bannerFolder: 'banners'};
  const first = await p.writeBuiltinCover(covers[1]);
  assert.equal(first, `banners/builtin-${covers[1].id}.svg`);
  assert.equal(writes[0][1], covers[1].svg);
  await p.writeBuiltinCover(covers[1]);
  assert.equal(writes.length, 1, 'an existing cover file must not be rewritten');
  console.log('PASS: gallery offline and well formed, picker works with no key, default fallback, cover file written once');
})().catch(e => { console.error(e); process.exit(1); });
