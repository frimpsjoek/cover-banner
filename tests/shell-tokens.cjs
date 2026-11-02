// Shell tokenizer: real commands from notes, whose names no fixed keyword list can know.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const obsidian = {Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, ItemView: class {}, Notice: class {}};
const ctx = {module: {exports: {}}, require: () => obsidian, URL};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('main.js', 'utf8'), ctx);
const run = (line, continued = false) => {
  ctx.line = line; ctx.continued = continued;
  const tokens = JSON.parse(vm.runInContext('JSON.stringify(shellTokens(line, continued))', ctx));
  return tokens.map(t => `${t.type}:${line.slice(t.from, t.to)}`);
};
assert.deepEqual(run('mpirun -n 1 ~/bin/lwannier.x -i wstat.in'), ['cmd:mpirun', 'flag:-n', 'path:~/bin/lwannier.x', 'flag:-i']);
assert.deepEqual(run('cd ~/runs && make lwannier -j14'), ['cmd:cd', 'path:~/runs', 'cmd:make', 'flag:-j14']);
assert.deepEqual(run('./setup.sh && source .venv/bin/activate'), ['cmd:./setup.sh', 'cmd:source', 'path:.venv/bin/activate']);
assert.deepEqual(run('alcf-tokens login --authorize-transfer home   # browser login -x'), ['cmd:alcf-tokens', 'flag:--authorize-transfer']);
assert.deepEqual(run('2>&1 | grep -E "Stage [23] --no" > out.log'), ['cmd:grep', 'flag:-E']);
assert.deepEqual(run('OMP_NUM_THREADS=4 mpirun -n 2 pw.x'), ['cmd:mpirun', 'flag:-n']);
assert.deepEqual(run('for f in *.in; do qsub job.pbs; done'), ['cmd:qsub']);
assert.deepEqual(run('    -L$HOME/lib -framework X', true), ['flag:-L$HOME/lib', 'flag:-framework']);
assert.deepEqual(run('# only a comment --flag'), []);
assert.deepEqual(run(''), []);
assert.equal(vm.runInContext('isShellLanguage("bash") && isShellLanguage("ZSH") && !isShellLanguage("python") && !isShellLanguage("")', ctx), true);
console.log('PASS: commands, flags, paths; comments, quotes, assignments, keywords and continuations handled');
