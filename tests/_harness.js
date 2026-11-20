// A tiny test helper shared by the files in tests/ (plain Node, no packages). Each test file does:
//     const { check, done, assert, root, loadScript } = require('./_harness');
//     check('what is true', () => { assert.strictEqual(...); });
//     done();
// check() accepts a function that returns a promise, too; done() waits for all of them, prints the result and
// sets the exit code, so `node tests/<file>.test.js` is all that is needed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
const pending = [];

function report(name, e) {
    fail++;
    console.log('FAIL', name, '\n   ', String((e && e.message) || e).split('\n').slice(0, 4).join('\n    '));
}

function check(name, fn) {
    try {
        const r = fn();
        if (r && typeof r.then === 'function') pending.push(r.then(() => { pass++; }, (e) => report(name, e)));
        else pass++;
    } catch (e) { report(name, e); }
}

async function done() {
    await Promise.all(pending);
    const label = path.basename(process.argv[1] || 'tests');
    console.log(fail === 0 ? `${label}: all ${pass} passed` : `${label}: ${fail} FAILED, ${pass} passed`);
    process.exit(fail ? 1 : 0);
}

// Runs one of the app's classic scripts (the ones without module.exports, or that need page globals faked) in a
// sandbox and returns the sandbox. `expose` lists top-level names to hand back (they are `const`/`function`
// declarations, which a script does not put on the global object by itself).
function loadScript(file, globals = {}, expose = []) {
    const sandbox = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, RegExp, Error, isNaN, parseInt, parseFloat, setTimeout, clearTimeout, ...globals });
    const code = fs.readFileSync(path.join(root, file), 'utf8') + '\n;' + expose.map(n => `this.${n} = ${n};`).join('\n');
    vm.runInContext(code, sandbox, { filename: file });
    return sandbox;
}

// Objects made inside a sandbox have the sandbox's own Array/Object, so compare them by value.
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

module.exports = { check, done, assert, root, loadScript, same, read, path, fs, vm };
