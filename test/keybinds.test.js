const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../shared/keybinds');

const allKeys = (b) => Object.values(b).flat();

test('the defaults are complete and no key does two things', () => {
    const d = K.defaults();
    for (const a of K.ACTIONS) assert.ok(d[a.id] && d[a.id].length > 0, `${a.id} has no default key`);
    assert.equal(new Set(allKeys(d)).size, allKeys(d).length, 'a default key is used twice');
    assert.ok(allKeys(d).every(K.isValidCode));
});

test('the defaults are what the game always used (WASD/arrows/space, F, G, C, V, E)', () => {
    const d = K.defaults();
    assert.equal(K.actionOf(d, 'KeyA'), 'left');
    assert.equal(K.actionOf(d, 'ArrowRight'), 'right');
    assert.equal(K.actionOf(d, 'Space'), 'jump');
    assert.equal(K.actionOf(d, 'KeyF'), 'push');
    assert.equal(K.actionOf(d, 'KeyG'), 'pull');
    assert.equal(K.actionOf(d, 'KeyC'), 'inhale');
    assert.equal(K.actionOf(d, 'KeyV'), 'power');
    assert.equal(K.actionOf(d, 'KeyE'), 'interact');
    assert.equal(K.actionOf(d, 'KeyQ'), null);
});

test('sanitize turns junk into valid bindings', () => {
    assert.deepEqual(K.sanitize(null), K.defaults());
    assert.deepEqual(K.sanitize('x'), K.defaults());
    assert.deepEqual(K.sanitize({}), K.defaults());
    const s = K.sanitize({ left: ['<script>', 5, null, 'KeyJ'], jump: 'Space', push: ['Escape', 'F5', 'Tab', 'MetaLeft'], evil: ['KeyZ'] });
    assert.deepEqual(s.left, ['KeyJ']);
    assert.ok(!('evil' in s));
    assert.ok(s.push.length > 0, 'a core action with only invalid keys falls back to its defaults');
    assert.ok(allKeys(s).every(K.isValidCode));
});

test('sanitize resolves two actions claiming one key: the earlier action keeps it', () => {
    const s = K.sanitize({ left: ['KeyJ'], right: ['KeyJ', 'KeyL'] });
    assert.deepEqual(s.left, ['KeyJ']);
    assert.deepEqual(s.right, ['KeyL']);
    assert.equal(new Set(allKeys(s)).size, allKeys(s).length);
});

test('sanitize limits an action to 3 keys', () => {
    const s = K.sanitize({ left: ['KeyH', 'KeyJ', 'KeyK', 'KeyL', 'KeyN'] });
    assert.equal(s.left.length, K.SLOTS);
});

test('binding a key takes it away from whatever used it, and says who lost it', () => {
    const d = K.defaults();
    const { bindings, displaced } = K.setKey(d, 'push', 0, 'KeyC'); // C was inhale
    assert.equal(K.actionOf(bindings, 'KeyC'), 'push');
    assert.deepEqual(displaced, ['inhale']);
    assert.deepEqual(bindings.inhale, [], 'inhale lost its only key');
    assert.equal(allKeys(bindings).filter(c => c === 'KeyC').length, 1);
    assert.deepEqual(d.inhale, ['KeyC'], 'the original is untouched');
});

test('rebinding to a free key replaces the slot; reserved/invalid keys are refused', () => {
    const d = K.defaults();
    let r = K.setKey(d, 'inhale', 0, 'KeyQ');
    assert.deepEqual(r.bindings.inhale, ['KeyQ']);
    assert.deepEqual(r.displaced, []);
    for (const bad of ['Escape', 'F5', 'Tab', 'MetaLeft', '', 'a b', 42, undefined]) {
        r = K.setKey(d, 'inhale', 0, bad);
        assert.deepEqual(r.bindings.inhale, ['KeyC'], `accepted ${bad}`);
    }
    r = K.setKey(d, 'nonsense', 0, 'KeyQ');
    assert.deepEqual(r.bindings, d);
});

test('clearing a slot removes just that key', () => {
    const d = K.defaults();
    const r = K.setKey(d, 'jump', 1, null);
    assert.deepEqual(r.bindings.jump, ['Space', 'ArrowUp']);
});

test('putting an action\'s own key into another slot moves it, no duplicates', () => {
    const d = K.defaults();
    const r = K.setKey(d, 'left', 1, 'KeyA'); // A is already its first key
    assert.equal(r.bindings.left.filter(c => c === 'KeyA').length, 1);
});

test('key labels are readable', () => {
    assert.equal(K.label('KeyA'), 'A');
    assert.equal(K.label('ArrowLeft'), '←');
    assert.equal(K.label('Digit3'), '3');
    assert.equal(K.label('Numpad2'), 'Num 2');
    assert.equal(K.label('Space'), 'Space');
    assert.equal(K.label('ShiftLeft'), 'Shift');
    assert.equal(K.label(null), '—');
    assert.equal(K.label('Quote'), 'Quote');
});

test('every key chip in the page that follows a binding names a real action', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const ids = new Set(K.ACTIONS.map(a => a.id));
    const used = [...html.matchAll(/data-act="([a-z0-9]+)"/g)].map(m => m[1]);
    assert.ok(used.length >= 8, 'the help screen should show the live bindings');
    for (const a of used) assert.ok(ids.has(a), `unknown action ${a}`);
});

test('a core action can never end up with no key, even when its defaults are all taken', () => {
    // give C (inhale's only default) to push and clear inhale
    const taken = K.setKey(K.defaults(), 'push', 0, 'KeyC').bindings;
    assert.deepEqual(taken.inhale, []);
    const fixed = K.sanitize(taken);
    for (const a of K.ACTIONS.filter(x => x.core)) assert.ok(fixed[a.id].length > 0, `${a.id} has no key`);
    assert.equal(new Set(allKeys(fixed)).size, allKeys(fixed).length, 'no key does two things');
    assert.ok(K.isValidCode(fixed.inhale[0]));
    assert.equal(K.actionOf(fixed, 'KeyC'), 'push', 'push keeps what we gave it');
});
