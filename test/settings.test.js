const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');
const { sanitizeSettings, DEFAULTS } = require('../game/settings');

const io = { to: () => ({ emit() {} }) };
const start = (room) => { room.startGame(); clearInterval(room.countdownInterval); room.countdownInterval = null; room.status = 'playing'; };

test('settings only accept the offered options', () => {
    assert.deepEqual(sanitizeSettings({ rounds: 5, lives: 1, items: false }), { ...DEFAULTS, rounds: 5, lives: 1, items: false });
    assert.deepEqual(sanitizeSettings({ rounds: 99, lives: 'x', mode: 'hax', items: 'yes', evil: 1 }), DEFAULTS);
    assert.deepEqual(sanitizeSettings(null), DEFAULTS);
    assert.deepEqual(sanitizeSettings('rounds'), DEFAULTS);
});

test('settings can be changed only in the waiting room', () => {
    const room = new GameRoom('0', io);
    room.addPlayer('a', 'A'); room.addPlayer('b', 'B');
    assert.equal(room.setSettings({ rounds: 5 }).rounds, 5);
    start(room);
    assert.equal(room.setSettings({ rounds: 1 }), null);
    assert.equal(room.settings.rounds, 5);
});

test('the number of rounds and hearts follow the settings', () => {
    const room = new GameRoom('0', io);
    room.addPlayer('a', 'A'); room.addPlayer('b', 'B');
    room.setSettings({ rounds: 1, lives: 1 });
    start(room);
    assert.equal(room.maxRounds, 1);
    assert.equal(room.players.a.respawnsLeft, 0, 'one heart = no respawns');
    room.players.a.die(); room.handleDeath(room.players.a);
    assert.equal(room.players.a.respawnMs, 0, 'out for the round');
});

test('items can be switched off', () => {
    const room = new GameRoom('0', io);
    room.addPlayer('a', 'A'); room.addPlayer('b', 'B');
    room.setSettings({ items: false });
    start(room);
    assert.equal(room.level.items.length, 0);
});

test('the level order: fixed cycles through the levels, shuffled uses each level once per cycle', () => {
    const room = new GameRoom('0', io);
    room.addPlayer('a', 'A'); room.addPlayer('b', 'B');
    room.setSettings({ rounds: 5, shuffle: false });
    const fixed = room.buildLevelOrder();
    assert.equal(fixed.length, 5);
    assert.equal(fixed[0], 1);

    room.setSettings({ rounds: 3, shuffle: true });
    for (let i = 0; i < 20; i++) {
        const order = room.buildLevelOrder();
        assert.equal(order.length, 3);
        assert.equal(new Set(order).size, 3, `repeated a level: ${order}`);
    }
});

test('each round loads the next level in the match order', () => {
    const room = new GameRoom('0', io);
    room.addPlayer('a', 'A'); room.addPlayer('b', 'B');
    room.setSettings({ rounds: 3, shuffle: false });
    start(room);
    const order = [...room.levelOrder];
    assert.equal(room.levelIndex, order[0]);
    room.players.a.isFinished = true; room.players.b.isFinished = true;
    room.checkRoundEnd();
    room.nextRound(); clearInterval(room.countdownInterval);
    assert.equal(room.levelIndex, order[1]);
    assert.equal(room.round, 2);
});

test('a match can be 1 to 8 levels long, and the lobby is told how many levels there are to pick from', () => {
    const room = new GameRoom('0', io);
    for (let n = 1; n <= 8; n++) {
        assert.equal(room.setSettings({ rounds: n }).rounds, n);
        assert.equal(room.buildLevelOrder().length, n);
    }
    assert.equal(room.setSettings({ rounds: 9 }).rounds, 8, 'out of range is ignored');
    assert.ok(room.publicSettings().pool >= 3);
});

test('real rooms start with shuffled level order switched on', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(src, /new GameRoom\(roomCode, io, \{ shuffle: true \}\)/);
});
