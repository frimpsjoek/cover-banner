// Auto-set on open sends note titles to Google Books and writes to notes, so it must be
// opt-in, with a setting to turn it on, and must leave the manual command available.
const {readFileSync} = require('node:fs');
const assert = require('node:assert/strict');
const js = readFileSync('main.js', 'utf8');
assert.match(js, /autoSetEnabled: false,/, 'autoSetEnabled must default to false');
assert.match(js, /autoSetOnOpen: false,/, 'autoSetOnOpen must default to false');
assert.match(js, /\.setName\("Auto-set banner on open"\)/, 'a setting must turn it on');
const gate = js.slice(js.indexOf('async maybeAutoSetForActiveFile()'));
assert.match(gate.slice(0, 120), /if \(!this\.settings\.autoSetEnabled\) return;/, 'on-open path must check the setting');
const manual = js.slice(js.indexOf('name: "Auto-set banner (URL/Book)"'));
assert.match(manual.slice(0, 400), /autoSetForFile\(/, 'manual command must not depend on the setting');
console.log('PASS: auto-set off by default, setting present, manual command unaffected');
