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
    p.x = -800; // outside the map: nothing to land on
    p.y = 100;
    simulate(room, 3000);
    assert.equal(p.isDead, true);
});

// ---------- Phase 2: KO credit, pull balance, catch-up, emotes ----------
const Player = require('../game/Player');

test('pushing a rival into a pit gives the pusher a KO bonus', () => {
    const { room, io } = startedRoom(2);
    const [a, b] = [room.players.p0, room.players.p1];
    b.markHit(a);
    b.die();
    room.handleDeath(b);

    const died = io.events.find(e => e.data.type === 'player_died');
    assert.equal(died.data.killerName, 'P0');
    assert.equal(died.data.name, 'P1');
    assert.equal(a.roundKos, 1);

    a.isFinished = true;
    room.checkRoundEnd();
    assert.equal(room.status, 'round_end');
    assert.equal(a.score, 10 + 3, 'finish points plus KO bonus');
    const sb = io.events.find(e => e.type === 'round_end').data.scoreboard.find(r => r.id === 'p0');
    assert.equal(sb.kos, 1);
    assert.equal(sb.roundPoints, 13);
});

test('dying on your own gives nobody a KO, and credit expires', () => {
    const { room } = startedRoom(2);
    const [a, b] = [room.players.p0, room.players.p1];

    b.die(); room.handleDeath(b);
    assert.equal(a.roundKos, 0);

    // credit that has timed out no longer counts
    const { room: r2 } = startedRoom(2);
    const [x, y] = [r2.players.p0, r2.players.p1];
    y.markHit(x);
    y.hitCredit.ms = 0;
    y.die(); r2.handleDeath(y);
    assert.equal(x.roundKos, 0);
});

test('a hit victim who lands safely loses the KO credit', () => {
    const { room } = startedRoom(2);
    simulate(room, 1000); // everyone grounded
    const [a, b] = [room.players.p0, room.players.p1];
    b.markHit(a);
    simulate(room, 800); // stays grounded well past the 400ms grace
    assert.equal(b.hitCredit, null);
});

test('falling off the map after being pushed is credited via the game loop', () => {
    const { room, io } = startedRoom(2);
    const [a, b] = [room.players.p0, room.players.p1];
    b.x = -800; b.y = 100; // outside the map
    b.markHit(a);
    simulate(room, 3500);
    assert.equal(b.isDead, true);
    assert.equal(a.roundKos, 1);
    const ev = io.events.find(e => e.data.type === 'player_died');
    assert.equal(ev.data.killerId, 'p0');
});

test('pull freezes for 1s and mashing keys breaks free early', () => {
    const { room } = startedRoom(2);
    simulate(room, 1000);
    const [a, b] = [room.players.p0, room.players.p1];
    b.pullDuration = Player.TUNING.pullFreeze;
    assert.equal(b.pullDuration, 1000);

    for (let i = 0; i < 4; i++) {
        room.handleInput('p1', { left: true });
        room.handleInput('p1', { left: false });
    }
    assert.ok(b.pullDuration <= 1000 - 4 * Player.TUNING.pullBreakFreePerTap, `still frozen ${b.pullDuration}`);

    for (let i = 0; i < 6; i++) {
        room.handleInput('p1', { jump: true });
        room.handleInput('p1', { jump: false });
    }
    assert.equal(b.pullDuration, 0);
    assert.ok(b.pullImmunity > 0, 'freed player is briefly immune');
});

test('holding a key does not count as mashing', () => {
    const { room } = startedRoom(2);
    const b = room.players.p1;
    b.pullDuration = 1000;
    room.handleInput('p1', { left: true });
    const after = b.pullDuration;
    room.handleInput('p1', { left: true });
    room.handleInput('p1', { left: true });
    assert.equal(b.pullDuration, after);
});

test('an immune or already-pulled player cannot be pulled again', () => {
    const { room } = startedRoom(2);
    const [a, b] = [room.players.p0, room.players.p1];
    a.x = 100; b.x = 150; a.y = b.y = 400; a.facing = 1;
    b.pullImmunity = 500;
    a.performPull(room);
    assert.equal(b.pullDuration, 0);

    b.pullImmunity = 0;
    a.pullCooldown = 0;
    a.performPull(room);
    assert.equal(b.pullDuration, Player.TUNING.pullFreeze);
});

test('pull freeze ends by itself and grants immunity', () => {
    const { room } = startedRoom(2);
    simulate(room, 500);
    const b = room.players.p1;
    b.pullDuration = 100;
    simulate(room, 200);
    assert.equal(b.pullDuration, 0);
    assert.ok(b.pullImmunity > 0);
});

test('trailing players get catch-up help; the leader does not', () => {
    const { room } = startedRoom(3);
    const f = room.level.finishZone;
    const [a, b, c] = ['p0', 'p1', 'p2'].map(id => room.players[id]);
    a.x = f.x - 100; a.y = f.y;       // leader, near the finish
    b.x = f.x - 300; b.y = f.y;       // within the gap
    c.x = f.x - 1200; c.y = f.y;      // far behind
    room.updateCatchUp();
    assert.equal(a.catchUp, false);
    assert.equal(b.catchUp, false);
    assert.equal(c.catchUp, true);
    assert.ok(c.pushCooldownMax < a.pushCooldownMax);
    assert.ok(c.pullCooldownMax < a.pullCooldownMax);
});

test('catch-up turns off when only one racer remains', () => {
    const { room } = startedRoom(2);
    room.players.p0.catchUp = true;
    room.players.p1.die();
    room.updateCatchUp();
    assert.equal(room.players.p0.catchUp, false);
});

test('emotes are validated and rate limited per player', () => {
    const { room, io } = startedRoom(2);
    const count = () => io.events.filter(e => e.type === 'game_effect' && e.data.type === 'emote').length;

    room.handleEmote('p0', 2);
    assert.equal(count(), 1);
    room.handleEmote('p0', 1);  // too soon
    assert.equal(count(), 1);
    room.handleEmote('p1', 99); // invalid
    room.handleEmote('p1', 'x');
    room.handleEmote('p1', -1);
    assert.equal(count(), 1);
    room.handleEmote('p1', 0);  // different player, valid
    assert.equal(count(), 2);
});
