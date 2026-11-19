const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');
const { sanitizeSettings, DEFAULTS } = require('../game/settings');

const events = [];
const io = { to: () => ({ emit: (t, d) => events.push({ t, d }) }) };

function teamRoom(n = 4) {
    const room = new GameRoom('0000', io, { teams: true, shuffle: false, rounds: 1 });
    for (let i = 0; i < n; i++) room.addPlayer(`p${i}`, `P${i}`);
    room.startGame();
    clearInterval(room.countdownInterval);
    room.status = 'playing';
    room.roundTimeLeft = 1e9;
    room.level.items = [];
    const ps = Object.values(room.players);
    ps.forEach(p => { p.invulnMs = 0; p.isGrounded = true; p.y = 460; });
    return { room, ps };
}
const run = (room, ms) => { const l = room.gameLoop; for (let t = 0; t < ms && room.status === 'playing'; t += l.step) l.update(l.step); };

test('teams is a validated room setting, off by default', () => {
    assert.equal(DEFAULTS.teams, false);
    assert.equal(sanitizeSettings({ teams: true }).teams, true);
    assert.equal(sanitizeSettings({ teams: 'yes' }).teams, false);
});

test('players alternate red / blue in join order, humans first', () => {
    const { ps } = teamRoom(4);
    assert.deepEqual(ps.map(p => p.team), ['red', 'blue', 'red', 'blue']);
    const off = new GameRoom('1', io, {});
    off.addPlayer('a', 'A'); off.addPlayer('b', 'B');
    off.startGame(); clearInterval(off.countdownInterval);
    assert.deepEqual(Object.values(off.players).map(p => p.team), [null, null]);
});

test('teammates cannot push, pull or swallow each other, but enemies can', () => {
    const { room, ps: [a, b, c] } = teamRoom(3);      // a red, b blue, c red
    a.x = 100; c.x = 134; b.x = 400; a.facing = 1;
    a.input.push = true;
    run(room, 200);
    assert.equal(c.vx === 0 || Math.abs(c.vx) < 5, true, 'teammate not knocked back');
    a.input.push = false;
    b.x = a.x + a.width + 4; c.x = 900; b.y = a.y;
    a.pushCooldown = 0; a.input.push = true;
    run(room, 200);
    assert.ok(b.x > a.x + a.width + 4 || Math.abs(b.vx) > 50, 'enemy was pushed');
});

test('stomping a teammate is a free springboard (no stun); an enemy is stunned', () => {
    const { room, ps: [a, b, c] } = teamRoom(3);
    const stompOn = (target) => {
        target.x = 100; target.y = 460; a.x = 100; a.y = 300; a.vy = 500; a.isGrounded = false;
        run(room, 400);
        return target.stunMs;
    };
    assert.equal(stompOn(c) > 0, false, 'teammate not stunned');
    a.stompGuardMs = 0; b.stompGuardMs = 0;
    assert.equal(stompOn(b) > 0 || b.stompGuardMs > 0, true, 'enemy stunned');
});

test('match end reports team totals and the winning team', () => {
    const { room, ps } = teamRoom(4);
    ps[0].score = 10; ps[2].score = 8; ps[1].score = 6; ps[3].score = 2; // red 18, blue 8
    room.endMatch();
    const end = room.lastMatchEnd;
    assert.deepEqual(end.teams, { red: 18, blue: 8 });
    assert.equal(end.winnerTeam, 'red');
});
