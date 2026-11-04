// Notes written for the older Banners plugin keep working: image forms, icon and crop position.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const obsidian = {Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, ItemView: class {}, Notice: class {}};
const ctx = {module: {exports: {}}, require: () => obsidian, URL};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('main.js', 'utf8'), ctx);
const call = (expr, value) => { ctx.value = value; return vm.runInContext(expr, ctx); };
for (const form of ['cover.png', '[[cover.png]]', '![[cover.png]]', '"![[cover.png]]"', '[[cover.png|Alt]]', '![[cover.png|600]]']) {
  assert.equal(call('normalizeFieldValue(value)', form), 'cover.png', form);
}
const focus = (fm) => call('bannerFocus(value)', fm);
assert.equal(focus({banner_x: 0.25, banner_y: 0.75}), '25% 75%');
assert.equal(focus({banner_y: 0.3}), '50% 30%');
assert.equal(focus({banner_x: '1', banner_y: 0}), '100% 0%');
assert.equal(focus({banner_y: 7}), '50% 100%');
assert.equal(focus({banner_y: 'top'}), null);
assert.equal(focus({}), null);
assert.equal(focus(null), null);
console.log('PASS: Banners image forms, crop position and bad values');
// Drag to reposition: the image follows the pointer, within the part that overflows the banner.
const drag = (args) => { ctx.args = args; return JSON.parse(vm.runInContext('JSON.stringify(dragFocus(...args))', ctx)); };
const box = {width: 1000, height: 300}, wide = {width: 2000, height: 2000};
assert.deepEqual(drag([{x: 0.5, y: 0.5}, 0, 70, box, wide]), {x: 0.5, y: 0.4});
assert.deepEqual(drag([{x: 0.5, y: 0.5}, 0, -70, box, wide]), {x: 0.5, y: 0.6});
assert.deepEqual(drag([{x: 0.5, y: 0.5}, 0, 5000, box, wide]), {x: 0.5, y: 0});
assert.deepEqual(drag([{x: 0.5, y: 0.5}, 200, 0, box, wide]), {x: 0.5, y: 0.5});
assert.deepEqual(drag([{x: 0.5, y: 0.5}, 100, 0, {width: 300, height: 300}, {width: 2000, height: 1000}]), {x: 0.167, y: 0.5});
assert.deepEqual(drag([{x: 0.5, y: 0.5}, 0, 70, box, {width: 0, height: 0}]), {x: 0.5, y: 0.5});
assert.equal(call('JSON.stringify(parseFocus(value))', '25% 75%'), '{"x":0.25,"y":0.75}');
assert.equal(call('JSON.stringify(parseFocus(value))', null), '{"x":0.5,"y":0.5}');
// Favicons from a clipped page: the largest declared icon, or the site's default location.
const icon = (html) => { ctx.html = html; return vm.runInContext('pickFavicon(html, "https://a.org/p/q")', ctx); };
assert.equal(icon('<link rel="icon" href="/i.png"><link rel="icon" sizes="192x192" href="/big.png"><link rel="icon" sizes="16x16" href="/small.png">'), 'https://a.org/big.png');
assert.equal(icon('<link href="i.svg" rel="shortcut icon">'), 'https://a.org/p/i.svg');
assert.equal(icon('<link rel="apple-touch-icon" href="https://cdn.org/t.png">'), 'https://cdn.org/t.png');
assert.equal(icon('<link rel="stylesheet" href="/s.css"><link rel="icon" href="data:image/png;base64,AA">'), 'https://a.org/favicon.ico');
assert.equal(icon(''), 'https://a.org/favicon.ico');
console.log('PASS: drag position within bounds, favicon choice');
