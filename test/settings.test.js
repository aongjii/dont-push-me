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

test('a room takes up to 8 players by default, with the cap chosen by the host', () => {
    const room = new GameRoom('0', io);
    for (let i = 0; i < 8; i++) assert.ok(room.addPlayer(`p${i}`, `P${i}`), `player ${i + 1} should fit`);
    assert.equal(room.addPlayer('p9', 'extra'), null, 'the 9th does not');
    const colors = Object.values(room.players).map(p => p.color.toUpperCase());
    assert.equal(new Set(colors).size, 8, 'every player has their own colour');

    const small = new GameRoom('0', io);
    small.setSettings({ maxPlayers: 4 });
    for (let i = 0; i < 4; i++) small.addPlayer(`p${i}`, `P${i}`);
    assert.equal(small.addPlayer('x', 'x'), null);
});

test('the cap cannot be lowered below the people already in the room', () => {
    const room = new GameRoom('0', io);
    for (let i = 0; i < 6; i++) room.addPlayer(`p${i}`, `P${i}`);
    assert.equal(room.setSettings({ maxPlayers: 4 }).maxPlayers, 8, 'refused');
    assert.equal(room.setSettings({ maxPlayers: 6 }).maxPlayers, 6);
});

test('8 players start the round on solid ground in every level, and nobody spawns inside the pit', () => {
    for (const level of [1, 2, 3]) {
        const room = new GameRoom('0', io);
        for (let i = 0; i < 8; i++) room.addPlayer(`p${i}`, `P${i}`);
        room.startGame(); clearInterval(room.countdownInterval);
        room.levelIndex = level; room.startRound(); clearInterval(room.countdownInterval);
        room.status = 'playing'; room.roundTimeLeft = 1e9;
        const start = room.level.platforms.find(p => room.level.spawnX >= p.x && room.level.spawnX < p.x + p.width);
        for (const p of Object.values(room.players)) {
            assert.ok(p.x >= start.x && p.x + p.width <= start.x + start.width, `level ${level}: ${p.id} spawns at x=${p.x}, off the start platform (${start.x}-${start.x + start.width})`);
        }
        for (let t = 0; t < 1000; t += 1000 / 60) room.gameLoop.update(1000 / 60);
        assert.ok(Object.values(room.players).every(p => !p.isDead), `level ${level}: someone died at the start`);
    }
});
