const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');

// Minimal stand-in for socket.io's server: records emitted events
function fakeIo() {
    const events = [];
    return {
        events,
        to: () => ({ emit: (type, data) => events.push({ type, data }) })
    };
}

function startedRoom(playerCount = 2, levelIndex = 1) {
    const io = fakeIo();
    const room = new GameRoom('0000', io);
    for (let i = 0; i < playerCount; i++) room.addPlayer(`p${i}`, `P${i}`);
    room.startGame();
    clearInterval(room.countdownInterval); // skip the real-time countdown
    room.countdownInterval = null;
    room.status = 'playing';
    return { room, io };
}

// Run the physics for `ms` of game time using the loop's own fixed step
function simulate(room, ms) {
    const loop = room.gameLoop;
    for (let t = 0; t < ms && room.status === 'playing'; t += loop.step) loop.update(loop.step);
}

test('players fall onto the floor and stay grounded', () => {
    const { room } = startedRoom(1);
    simulate(room, 1500);
    const p = room.players.p0;
    assert.equal(p.isGrounded, true);
    assert.equal(p.isDead, false);
});

test('fixed step: same inputs give the same result regardless of tick timing', () => {
    const run = (chunks) => {
        const { room } = startedRoom(1);
        room.players.p0.input.right = true;
        room.gameLoop.lastTime = 0;
        const realNow = Date.now;
        let now = 0;
        Date.now = () => now;
        try {
            room.gameLoop.lastTime = 0;
            for (const c of chunks) { now += c; room.gameLoop.tick(); }
        } finally { Date.now = realNow; }
        return room.players.p0.x;
    };
    // 600ms total, delivered as even ticks vs. bursty ticks
    const even = run(Array(30).fill(20));
    const bursty = run([5, 55, 10, 90, 20, 20, 40, 60, 100, 100, 100, 100]);
    assert.ok(Math.abs(even - bursty) < 20, `positions diverged: ${even} vs ${bursty}`);
});

test('finishing orders award 10/8/6/4 points; dead players get 0', () => {
    const { room } = startedRoom(3);
    const [a, b, c] = ['p0', 'p1', 'p2'].map(id => room.players[id]);
    a.isFinished = true; room.checkRoundEnd();
    b.isFinished = true; room.checkRoundEnd();
    c.die(); room.checkRoundEnd();

    assert.equal(room.status, 'round_end');
    assert.equal(a.score, 10);
    assert.equal(b.score, 8);
    assert.equal(c.score, 0);
});

test('round ends when time runs out and unfinished players score 0', () => {
    const { room, io } = startedRoom(2);
    room.players.p0.isFinished = true; // one finisher, one still running
    room.roundTimeLeft = 50;

    simulate(room, 100);

    assert.equal(room.status, 'round_end');
    assert.equal(room.players.p0.score, 10);
    assert.equal(room.players.p1.score, 0);
    const end = io.events.find(e => e.type === 'round_end');
    assert.deepEqual(end.data.finishOrder, ['P0']);
});

test('round does not end early while someone is still running', () => {
    const { room } = startedRoom(2);
    room.players.p0.isFinished = true;
    simulate(room, 500);
    assert.equal(room.status, 'playing');
});

test('endRound cannot score twice', () => {
    const { room } = startedRoom(2);
    room.players.p0.isFinished = true;
    room.players.p1.isFinished = true;
    room.checkRoundEnd();
    room.endRound();
    room.endRound();
    assert.equal(room.players.p0.score, 10);
});

test('handleInput ignores unknown keys and non-boolean values', () => {
    const { room } = startedRoom(1);
    room.handleInput('p0', { left: true, jump: 'true', hack: true });
    const input = room.players.p0.input;
    assert.equal(input.left, true);
    assert.equal(input.jump, false);
    assert.equal('hack' in input, false);
});

test('state broadcast carries remaining time in whole seconds', () => {
    const { room, io } = startedRoom(1);
    room.roundTimeLeft = 12345;
    room.broadcastState();
    const state = io.events.find(e => e.type === 'game_state');
    assert.equal(state.data.timeLeft, 13);
});

test('a player falling off the map dies', () => {
    const { room } = startedRoom(1);
    const p = room.players.p0;
    p.x = 5000; // far from any platform
    p.y = 100;
    simulate(room, 3000);
    assert.equal(p.isDead, true);
});
