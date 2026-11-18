const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// icons.js is a browser script: run it with a tiny fake DOM and inspect the definitions
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'icons.js'), 'utf8');
const ctx = vm.createContext({ document: {}, Path2D: class {} });
vm.runInContext(src + '\nthis.IconsExport = Icons;', ctx);
const Icons = ctx.IconsExport;

test('the icon set covers everything the game used emoji for', () => {
    const needed = ['fire', 'ice', 'spin', 'wings', 'inhale', 'push', 'pull', 'lever', 'star', 'apple', 'skull',
        'laugh', 'angry', 'wave', 'crown', 'clock', 'wifi', 'rocket', 'eyes', 'door', 'book', 'shirt', 'dice',
        'sound_on', 'sound_off', 'flag', 'wind', 'burst', 'warn', 'cross', 'heart', 'heart_empty'];
    for (const n of needed) assert.ok(Icons.names.includes(n), `missing icon ${n}`);
});

test('every icon is well formed (known shape kinds, right number of fields, valid numbers)', () => {
    const arity = { p: 5, c: 7, e: 8, r: 9 };
    for (const name of Icons.names) {
        const def = Icons.DEFS[name];
        assert.ok(def.length > 0, `${name} is empty`);
        for (const s of def) {
            assert.ok(arity[s[0]], `${name}: unknown shape ${s[0]}`);
            assert.equal(s.length, arity[s[0]], `${name}: wrong field count for ${s[0]}`);
            const nums = s[0] === 'p' ? [s[4]] : s.slice(1).filter(v => typeof v === 'number');
            nums.forEach(n => assert.ok(Number.isFinite(n), `${name}: bad number`));
            if (s[0] === 'p') assert.match(s[1], /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$/, `${name}: odd path data`);
        }
    }
});

test('emotes used by the server are icons the client can draw', () => {
    const { EMOTE_COUNT } = require('../game/validation');
    const emotes = ['laugh', 'angry', 'wave', 'skull'];
    assert.equal(emotes.length, EMOTE_COUNT);
    emotes.forEach(n => assert.ok(Icons.names.includes(n)));
});
