const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');
const Skins = require('../shared/skins');

const io = { to: () => ({ emit() {} }) };

test('the catalogue has the basics, including the Abe face', () => {
    assert.ok(Skins.COLORS.length >= 16);
    assert.ok(Skins.FACES.length >= 13);
    assert.ok(Skins.HATS.length >= 22);
    assert.ok(Skins.ACCS.length >= 17);
    assert.ok(Skins.PATTERNS.length >= 7);
    assert.ok(Skins.FACES.some(f => f.id === 'abe'));
    assert.ok(Skins.ACCS.some(a => a.id === 'overalls'));
    // ids are unique within each list
    for (const list of [Skins.COLORS, Skins.FACES, Skins.HATS, Skins.ACCS, Skins.PATTERNS]) {
        const keys = list.map(o => o.id);
        assert.equal(new Set(keys).size, keys.length);
    }
    assert.equal(new Set(Skins.COLORS.map(c => c.hex)).size, Skins.COLORS.length);
});

test('sanitizeSkin accepts valid skins and rejects everything else', () => {
    const ok = Skins.sanitizeSkin({ color: '#5bb8ff', face: 'abe', hat: 'crown', acc: 'overalls' });
    assert.deepEqual(ok, { color: '#5BB8FF', face: 'abe', hat: 'crown', acc: 'overalls', pat: 'none' });
    assert.equal(Skins.sanitizeSkin({ pat: 'stars' }).pat, 'stars');
    assert.equal(Skins.sanitizeSkin({ pat: 'nope' }).pat, 'none');

    const bad = Skins.sanitizeSkin({ color: 'red', face: '<script>', hat: { x: 1 }, acc: 42, extra: 'nope' });
    assert.deepEqual(bad, Skins.DEFAULT_SKIN);

    for (const junk of [null, undefined, 'abe', 7, [], () => {}]) {
        assert.deepEqual(Skins.sanitizeSkin(junk), Skins.DEFAULT_SKIN);
    }
    // only known keys come out
    assert.deepEqual(Object.keys(Skins.sanitizeSkin({ color: '#FF7EA8', evil: 1 })).sort(), ['acc', 'color', 'face', 'hat', 'pat']);
});

test('randomSkin always produces a valid skin', () => {
    for (let i = 0; i < 100; i++) {
        const s = Skins.randomSkin();
        assert.deepEqual(Skins.sanitizeSkin(s), s);
    }
});

test('players get the skin they asked for, but body colours stay unique in a room', () => {
    const room = new GameRoom('0000', io);
    const a = room.addPlayer('a', 'A', { color: '#5BB8FF', face: 'abe', hat: 'crown', acc: 'overalls' });
    const b = room.addPlayer('b', 'B', { color: '#5BB8FF', face: 'cat', hat: 'none', acc: 'none' });
    assert.equal(a.color, '#5BB8FF');
    assert.deepEqual(a.skin, { face: 'abe', hat: 'crown', acc: 'overalls', pat: 'none' });
    assert.notEqual(b.color.toUpperCase(), a.color.toUpperCase(), 'duplicate colour was not swapped');
    assert.equal(b.skin.face, 'cat', 'but their other choices are kept');
});

test('players who send no skin still get distinct colours (4 default players)', () => {
    const room = new GameRoom('0000', io);
    for (let i = 0; i < 4; i++) room.addPlayer(`p${i}`, `P${i}`);
    const colors = Object.values(room.players).map(p => p.color.toUpperCase());
    assert.equal(new Set(colors).size, 4);
});

test('setSkin works in the lobby only, validates input, and never steals a colour', () => {
    const room = new GameRoom('0000', io);
    const a = room.addPlayer('a', 'A', { color: '#FF7EA8' });
    const b = room.addPlayer('b', 'B', { color: '#5BB8FF' });

    const res = room.setSkin('b', { color: '#FF7EA8', face: 'angry', hat: 'horns', acc: 'cape' });
    assert.equal(res.color, '#5BB8FF', 'colour in use by A was not taken');
    assert.equal(b.skin.face, 'angry');
    assert.equal(b.skin.hat, 'horns');

    assert.equal(room.setSkin('b', { color: '#B28DFF', face: 'bogus' }).color, '#B28DFF');
    assert.equal(b.skin.face, 'classic', 'invalid face falls back to the default');
    assert.equal(room.setSkin('nobody', {}), null);

    room.status = 'playing';
    assert.equal(room.setSkin('b', { face: 'abe' }), null, 'cannot change look mid-game');
    assert.notEqual(b.skin.face, 'abe');
});

test('the skin is broadcast to every client in each game state', () => {
    const events = [];
    const room = new GameRoom('0000', { to: () => ({ emit: (t, d) => events.push({ t, d }) }) });
    room.addPlayer('a', 'A', { color: '#6FD98C', face: 'abe', hat: 'tophat', acc: 'mustache' });
    room.addPlayer('b', 'B');
    room.startGame();
    clearInterval(room.countdownInterval);
    room.status = 'playing';
    room.broadcastState();
    const state = events.find(e => e.t === 'game_state').d;
    const a = state.players.find(p => p.id === 'a');
    assert.deepEqual([a.color, a.face, a.hat, a.acc, a.pat], ['#6FD98C', 'abe', 'tophat', 'mustache', 'none']);
    const b = state.players.find(p => p.id === 'b');
    assert.equal(b.face, 'classic');
});

test('dressing up does not affect gameplay (hitbox and physics are the same)', () => {
    const room = new GameRoom('0000', io);
    const a = room.addPlayer('a', 'A', { face: 'abe', hat: 'tophat', acc: 'cape' });
    const b = room.addPlayer('b', 'B');
    assert.equal(a.width, b.width);
    assert.equal(a.height, b.height);
});
