const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');

const io = { to: () => ({ emit() {} }) };
const STEP = 1000 / 60;

function lobby() {
    const room = new GameRoom('0', io);
    room.addPlayer('h1', 'Human');
    return room;
}
function startOn(room, level = 1) {
    room.startGame();
    clearInterval(room.countdownInterval);
    room.levelIndex = level;
    room.startRound();
    clearInterval(room.countdownInterval);
    room.countdownInterval = null;
    room.status = 'playing';
    room.roundTimeLeft = 1e9;
}

test('bots can be added and removed in the waiting room, up to 4 players in total', () => {
    const room = lobby();
    assert.ok(room.addBot());
    assert.ok(room.addBot());
    assert.ok(room.addBot());
    assert.equal(room.addBot(), null, 'room is full');
    assert.equal(Object.keys(room.players).length, 4);
    assert.equal(room.removeLastBot(), true);
    assert.equal(Object.keys(room.players).length, 3);
    assert.equal(room.humanCount(), 1);
});

test('bots cannot be added once the game started', () => {
    const room = lobby();
    room.addBot();
    startOn(room);
    assert.equal(room.addBot(), null);
    assert.equal(room.removeLastBot(), false);
});

test('a room with only bots left is closed', () => {
    const room = lobby();
    room.addBot();
    room.removePlayer('h1');
    assert.equal(room.humanCount(), 0);
    assert.equal(room.gameLoop.intervalId, null);
});

test('the round ends when the humans are done, even if bots have not finished', () => {
    const room = lobby();
    room.addBot();
    startOn(room);
    room.players.h1.isFinished = true;
    room.checkRoundEnd();
    assert.equal(room.status, 'round_end');
    assert.equal(room.players.h1.score, 10);
    const bot = Object.values(room.players).find(p => p.isBot);
    assert.equal(bot.score, 0);
});

test('bots never run out of hearts', () => {
    const room = lobby();
    room.addBot();
    startOn(room);
    const bot = Object.values(room.players).find(p => p.isBot);
    assert.ok(bot.respawnsLeft > 100);
});

test('a bot makes real progress along a level (walks, jumps, plans) and does not crash', () => {
    for (const level of [1, 2, 3]) {
        const room = new GameRoom('0', io);
        room.addBot();
        startOn(room, level);
        const bot = Object.values(room.players)[0];
        const vertical = room.level.height > room.level.width;
        const f = room.level.finishZone;
        let best = 0;
        for (let t = 0; t < 60000; t += STEP) {
            room.gameLoop.update(STEP);
            const prog = vertical
                ? (room.level.spawnY - bot.y) / (room.level.spawnY - f.y)
                : (bot.x - room.level.spawnX) / (f.x - room.level.spawnX);
            best = Math.max(best, prog);
        }
        assert.ok(best > 0.12, `level ${level}: the bot only got ${(best * 100).toFixed(0)}% of the way in a minute`);
    }
});

test('a dummy bot stands perfectly still (practice target)', () => {
    const room = lobby();
    const dummy = room.addBot({ dummy: true, name: 'Dummy' });
    startOn(room);
    const x0 = dummy.x;
    for (let t = 0; t < 3000; t += STEP) room.gameLoop.update(STEP);
    assert.ok(Math.abs(dummy.x - x0) < 1);
});

test('bots shove people but never each other', () => {
    const room = new GameRoom('0', io);
    const a = room.addBot(); const b = room.addBot();
    startOn(room);
    a.x = 300; a.y = 460; b.x = 330; b.y = 460; a.facing = 1;
    const brain = room.bots[a.id];
    brain.aggression = 1; // always
    brain.maybeShove(room);
    assert.equal(a.input.push, false);
});
