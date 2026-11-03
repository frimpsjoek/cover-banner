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
// Heredoc bodies are data, not commands; the scanner carries state between lines.
const scan = (lines) => {
  ctx.lines = lines;
  return JSON.parse(vm.runInContext('(() => { const next = shellLineScanner(); return JSON.stringify(lines.map((l) => next(l).map((t) => l.slice(t.from, t.to)))); })()', ctx));
};
assert.deepEqual(scan(["cat > job.pbs <<'EOF'", '#PBS -N x', 'cd $DIR', '~/bin/run --flag', 'EOF', 'qsub job.pbs']), [['cat'], [], [], [], [], ['qsub']]);
assert.deepEqual(scan(['cat <<-EOF', '\trun', '\tEOF', 'ls']), [['cat'], [], [], ['ls']]);
assert.deepEqual(scan(['cat <<<word', 'ls']), [['cat'], ['ls']]);
assert.deepEqual(scan(['echo "a << b"', 'ls']), [['echo'], ['ls']]);
assert.deepEqual(scan(['ls # see <<EOF', 'pwd']), [['ls'], ['pwd']]);
assert.deepEqual(scan(['make all \\', '  -j4', 'ls']), [['make', ], ['-j4'], ['ls']]);
// Blocks with no language: real code gets colour, prose and program output stay plain.
const block = (language, lines) => {
  ctx.language = language; ctx.lines = lines;
  return JSON.parse(vm.runInContext('JSON.stringify(codeBlockTokens(language, lines).map((ts, i) => ts.map((t) => `${t.type}:${lines[i].slice(t.from, t.to)}`)))', ctx));
};
assert.deepEqual(block('', ['Gamma_hole', '  1.55                 ! core-hole width (eV)', 'All_conv               ! also write spectra']),
  [['keyword:Gamma_hole'], ['number:1.55', 'comment:! core-hole width (eV)'], ['keyword:All_conv', 'comment:! also write spectra']]);
assert.deepEqual(block('text', ['! header', 'Range', '  -5. 0.5 1e-3']), [['comment:! header'], ['keyword:Range'], ['number:-5.', 'number:0.5', 'number:1e-3']]);
assert.deepEqual(block('', ['&CONTROL', "  prefix = 'si'   ! name", '  nstep = 10', '/']),
  [['keyword:&CONTROL'], ['key:prefix', "string:'si'", 'comment:! name'], ['key:nstep', 'number:10'], []]);
assert.deepEqual(block('', ['! ssh -fN carbon1 && ls -la']), [['cmd:ssh', 'flag:-fN', 'cmd:ls', 'flag:-la']]);
assert.deepEqual(block('', ['The result was great! We ran 10 jobs.', 'Next step is to look at 3 more.']), [[], []]);
assert.deepEqual(block('', ['Epoch 1 loss 0.25', 'Epoch 2 loss 0.21']), [[], []]);
assert.deepEqual(block('', ['x != 3', 'value != 4']), [[], []]);
assert.deepEqual(block('python', ['x = 1  ! not a comment here']), [[]]);
assert.deepEqual(block('bash', ['ls -la']), [['cmd:ls', 'flag:-la']]);
// Real blocks from the FDMNES, FEFF and VASP notes.
assert.deepEqual(block('', ['! fcc Cu, K edge', 'Crystal', 'Cu 0.0 0.0 0.5 1 2']), [['comment:! fcc Cu, K edge'], ['keyword:Crystal'], ['number:0.0', 'number:0.0', 'number:0.5', 'number:1', 'number:2']]);
assert.deepEqual(block('', ['* header', 'CONTROL 1 1', 'S02 0     ! computed']), [['comment:* header'], ['keyword:CONTROL', 'number:1', 'number:1'], ['keyword:S02', 'number:0', 'comment:! computed']]);
assert.deepEqual(block('', ['ENCUT = 520   PREC = Accurate', 'EDIFF = 1E-5  LASPH = .TRUE.']), [['key:ENCUT', 'number:520', 'key:PREC'], ['key:EDIFF', 'number:1E-5', 'key:LASPH']]);
assert.deepEqual(block('', ['module load feff/9.6     # once access exists', 'cd run_dir && feff']), [['cmd:module', 'path:feff/9.6'], ['cmd:cd', 'cmd:feff']]);
assert.deepEqual(block('', ['ENCUT = 520', 'ISMEAR = 1', 'POSCAR: selective dynamics for the bottom three layers']).map((l) => l.length > 0), [true, true, false]);
assert.deepEqual(block('', ['S02 0   ! computed', 'RPATH 8', 'EDGE K', '  x y z ipot tag distance number']).map((l) => l.length > 0).slice(0, 3), [true, true, true]);
// Look-alikes that must stay plain.
assert.deepEqual(block('', ['~/opt/fdmnes/', '  linux/fdmnes   serial, static binary', '  dl/a.pdf, dl/b.txt,']),
  [['path:~/opt/fdmnes/'], ['path:linux/fdmnes', 'comment:serial, static binary'], ['path:dl/a.pdf', 'path:dl/b.txt']]);
assert.deepEqual(block('', ['https://a.org/x   a link', 'https://b.org/y   another']), [[], []]);
assert.deepEqual(block('', ['and/or we could try this', 'see the notes for more']), [[], []]);
assert.deepEqual(block('', ['Green    multiple-scattering on a muffin-tin potential', 'Radius 6.0   cluster radius around each absorber']), [[], []]);
assert.deepEqual(block('', ['N=100 (calls 2-3):   xi is inside', 'N=171 (calls 2-5):   xi is inside']), [[], []]);
assert.deepEqual(block('', ['make sure the output folder is there', 'cd into it and look around for a while']), [[], []]);
console.log('PASS: commands, flags, paths; comments, quotes, assignments, keywords and continuations handled');
