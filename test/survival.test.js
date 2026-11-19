const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');

const io = { to: () => ({ emit() {} }) };

function arenaRoom(n = 3, lives = 1) {
    const room = new GameRoom('0000', io, { mode: 'survival', lives, rounds: 1, shuffle: false });
    for (let i = 0; i < n; i++) room.addPlayer(`p${i}`, `P${i}`);
    room.startGame();
    clearInterval(room.countdownInterval);
    room.countdownInterval = null;
    room.status = 'playing';
    room.roundTimeLeft = 1e9;
    return room;
}
const run = (room, ms) => { const l = room.gameLoop; for (let t = 0; t < ms && room.status === 'playing'; t += l.step) l.update(l.step); };

test('survival mode uses the arena levels', () => {
    const room = arenaRoom(2);
    assert.equal(room.level.mode, 'survival');
    assert.match(String(room.levelIndex), /^arena/);
});

test('last one standing wins; points follow the order people dropped out', () => {
    const room = arenaRoom(3, 1);
    const [a, b, c] = Object.values(room.players);
    c.y = 5000; run(room, 100);          // c falls first
    assert.equal(room.status, 'playing', 'two still alive: round continues');
    b.y = 5000; run(room, 100);          // then b
    assert.equal(room.status, 'round_end');
    assert.deepEqual(room.finishOrder, [a.id, b.id, c.id]);
    assert.ok(a.score > b.score && b.score > c.score, `${a.score} ${b.score} ${c.score}`);
});

test('with 3 lives a fall costs a life and you come back onto a platform that will last', () => {
    const room = arenaRoom(2, 3);
    const [a, b] = Object.values(room.players);
    a.y = 5000; run(room, 100);
    assert.equal(a.respawnsLeft, 1);
    run(room, 3200);
    assert.equal(a.isDead, false, 'back in the game');
    const under = room.level.platforms.find(pl => pl.active && a.x + a.width > pl.x && a.x < pl.x + pl.width);
    assert.ok(under, 'standing over a platform');
    assert.equal(room.status, 'playing');
    assert.ok(b);
});

test('arena platforms warn, then collapse for good on schedule', () => {
    const room = arenaRoom(2, 1);
    const pl = room.level.platforms.find(p => p.crumbleAt !== null);
    const t = pl.crumbleAt;
    room.level.elapsed = t - 1000; room.level.update(16);
    assert.equal(pl.warn, true);
    assert.equal(pl.active, true);
    room.level.elapsed = t; room.level.update(16);
    assert.equal(pl.active, false);
    room.level.update(8000);
    assert.equal(pl.active, false, 'it does not come back');
});

test('a survival round ends when time runs out with the survivors sharing the win', () => {
    const room = arenaRoom(2, 1);
    room.roundTimeLeft = 50;
    run(room, 200);
    assert.equal(room.status, 'round_end');
    assert.equal(room.finishOrder.length, 2);
});
