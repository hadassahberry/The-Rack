// Runs every test in the repo and prints one line each:
//     node tests/run-all.js
// It runs each tests/*.test.js with Node, then the server function's own tests in functions/test (Node's built-in
// test runner). Nothing needs installing, and none of it touches a page, storage or the network.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failed = 0, checks = 0;
const rows = [];

fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort().forEach(file => {
    const r = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8', cwd: root });
    const out = (r.stdout || '') + (r.stderr || '');
    const last = out.trim().split('\n').pop();
    const m = /(\d+) passed/.exec(last);
    if (m) checks += Number(m[1]);
    if (r.status !== 0) { failed++; console.log(out.trim()); }
    rows.push(`${r.status === 0 ? 'ok  ' : 'FAIL'} tests/${file}  ${last.replace(/^[^:]*:\s*/, '')}`);
});

const fnDir = path.join(root, 'functions', 'test');
if (fs.existsSync(fnDir)) {
    const files = fs.readdirSync(fnDir).filter(f => f.endsWith('.test.js')).map(f => path.join('test', f));
    const r = spawnSync(process.execPath, ['--test', ...files], { encoding: 'utf8', cwd: path.join(root, 'functions') });
    const out = (r.stdout || '') + (r.stderr || '');
    const pass = (/ℹ pass (\d+)/.exec(out) || [])[1], fail = (/ℹ fail (\d+)/.exec(out) || [])[1];
    if (pass) checks += Number(pass);
    if (r.status !== 0) { failed++; console.log(out.trim()); }
    rows.push(`${r.status === 0 ? 'ok  ' : 'FAIL'} functions/test  ${pass || 0} passed${fail && fail !== '0' ? `, ${fail} FAILED` : ''}`);
}

console.log(rows.join('\n'));
console.log(failed === 0 ? `\nAll good: ${checks} checks passed.` : `\n${failed} test file(s) FAILED (${checks} checks passed).`);
process.exit(failed ? 1 : 0);
