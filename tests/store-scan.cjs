// The Obsidian community site warns about these; keep the plugin clear of them.
const fs = require('node:fs'), assert = require('node:assert/strict');
const raw = fs.readFileSync('styles.css', 'utf8');
const css = raw.replace(/url\(["']?data:[^)]*\)/g, 'url(DATA)');
assert.ok(Buffer.byteLength(raw) < 5e6, `styles.css is ${Buffer.byteLength(raw)} bytes; Obsidian Sync Standard stops at 5 MB`);
assert.ok(!css.includes('!important'), 'styles.css uses !important');
assert.ok(!css.includes(':has('), 'styles.css uses :has');
const js = fs.readFileSync('main.js', 'utf8');
assert.ok(!js.includes('!important') && !js.includes(':has('), 'main.js injects !important or :has');
const fonts = [...raw.matchAll(/url\(["']?data:([^;]+);base64,/g)].map((m) => m[1]);
assert.equal(fonts.length, 9, 'all nine bundled fonts stay');
assert.ok(fonts.every((t) => t === 'font/woff2'), `bundled fonts must be WOFF2, found ${[...new Set(fonts)]}`);
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
assert.ok(manifest.description.length <= 250);
console.log(`PASS: styles.css ${(Buffer.byteLength(raw) / 1e6).toFixed(2)} MB, no !important, no :has, nine WOFF2 fonts`);
