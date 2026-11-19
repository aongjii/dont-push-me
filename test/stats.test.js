const test = require('node:test');
const assert = require('node:assert/strict');
const Stats = require('../shared/stats');
const Skins = require('../shared/skins');

const memory = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };

test('counters start at zero and persist between sessions', () => {
    const store = memory();
    const a = Stats.create(store);
    assert.equal(a.counters().kos, 0);
    a.add('kos'); a.add('kos', 2); a.add('rounds');
    const b = Stats.create(store);
    assert.equal(b.counters().kos, 3);
    assert.equal(b.counters().rounds, 1);
});

test('unknown counters are ignored and corrupt storage does not crash', () => {
    const store = memory();
    store.setItem(Stats.KEY, '{not json');
    const s = Stats.create(store);
    s.add('hax');
    assert.equal(s.counters().hax, undefined);
    store.setItem(Stats.KEY, JSON.stringify({ counters: { kos: -4, rounds: 'x', deaths: 2.7 }, best: { 1: -5, 2: 40000 } }));
    const t = Stats.create(store);
    assert.equal(t.counters().kos, 0);
    assert.equal(t.counters().rounds, 0);
    assert.equal(t.counters().deaths, 2);
    assert.deepEqual(t.best(), { 2: 40000 });
    assert.doesNotThrow(() => Stats.create(null).add('kos'));
});

test('best times keep only records', () => {
    const s = Stats.create(memory());
    assert.equal(s.recordTime(1, 50000), true);
    assert.equal(s.recordTime(1, 60000), false);
    assert.equal(s.recordTime(1, 42000), true);
    assert.equal(s.recordTime(1, -1), false);
    assert.deepEqual(s.best(), { 1: 42000 });
});

test('cosmetics unlock from stats and locked ones fall back to plain', () => {
    assert.equal(Skins.isUnlocked('hat', 'crown', { roundWins: 2 }), false);
    assert.equal(Skins.isUnlocked('hat', 'crown', { roundWins: 3 }), true);
    assert.equal(Skins.isUnlocked('hat', 'cap', {}), true, 'free items are never locked');
    const skin = { color: '#FF7EA8', face: 'abe', hat: 'crown', acc: 'cape', pat: 'stars' };
    assert.deepEqual(Skins.withoutLocked(skin, {}), { ...skin, hat: 'none', acc: 'none', pat: 'none' });
    assert.deepEqual(Skins.withoutLocked(skin, { roundWins: 5, rounds: 15 }), skin);
    assert.ok(Skins.unlockedList({ matchWins: 1 }).includes('hat:halo'));
});

test('every unlock rule points at a real item and a real counter', () => {
    const catalog = { hat: Skins.HATS, acc: Skins.ACCS, pat: Skins.PATTERNS };
    const counters = Stats.COUNTERS.map(c => c.id);
    for (const part of Object.keys(Skins.UNLOCKS)) for (const [id, u] of Object.entries(Skins.UNLOCKS[part])) {
        assert.ok(catalog[part].some(o => o.id === id), `${part}:${id} does not exist`);
        assert.ok(counters.includes(u.stat), `${part}:${id} uses unknown counter ${u.stat}`);
        assert.ok(u.n > 0 && u.text);
    }
});
