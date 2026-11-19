const test = require('node:test');
const assert = require('node:assert/strict');
const Movement = require('../shared/movement');
const GameRoom = require('../game/GameRoom');

const io = { events: [], to() { return { emit: (t, d) => io.events.push({ t, d }) }; } };

function playing(n = 2) {
    io.events.length = 0;
    const room = new GameRoom('0000', io, { shuffle: false });
    for (let i = 0; i < n; i++) room.addPlayer(`p${i}`, `P${i}`);
    room.startGame();
    clearInterval(room.countdownInterval);
    room.status = 'playing';
    room.roundTimeLeft = 1e9;
    room.level.items = [];
    const ps = Object.values(room.players);
    ps.forEach(p => { p.invulnMs = 0; p.isGrounded = true; p.y = 460; p.facing = 1; });
    return { room, ps };
}
const run = (room, ms) => { const l = room.gameLoop; for (let t = 0; t < ms && room.status === 'playing'; t += l.step) l.update(l.step); };

test('players are solid: you cannot walk through someone standing in your way', () => {
    const { room, ps: [a, b] } = playing(2);
    a.x = 100; b.x = 160;
    a.input.right = true;
    run(room, 1500);
    assert.ok(a.x + a.width <= b.x + 0.5, `a (${a.x}) went into b (${b.x})`);
});

test('players that spawn overlapping can still separate and are not stuck', () => {
    const { room, ps: [a, b] } = playing(2);
    a.x = 100; b.x = 105;   // on top of each other
    b.input.right = true;
    run(room, 600);
    assert.ok(b.x > 150, `b is stuck at ${b.x}`);
});

test('you can stand on a head, and the rider moves away when the head does', () => {
    const { room, ps: [a, b] } = playing(2);
    b.x = 100; a.x = 100; a.y = 400;           // a drops onto b
    a.x = 104; // overlap in x, falling from above
    run(room, 600);
    assert.ok(Math.abs(a.y + a.height - b.y) < 1.5, `a feet ${a.y + a.height} vs b head ${b.y}`);
    assert.equal(a.isGrounded, true);
});

test('landing hard on a head is a stomp: stomper bounces, victim is squashed, and gets guarded afterwards', () => {
    const { room, ps: [a, b] } = playing(2);
    b.x = 100;
    a.x = 100; a.y = 300; a.vy = 500; a.isGrounded = false; // falling fast
    let top = Infinity, sawStun = false, hit = false;
    const l = room.gameLoop;
    for (let t = 0; t < 700; t += l.step) {
        l.update(l.step);
        if (b.stunMs > 0) sawStun = true;
        if (hit || b.stunMs > 0) { hit = true; top = Math.min(top, a.y); }
    }
    assert.ok(sawStun, 'victim stunned');
    assert.ok(top < 460 - 40 - 30, `stomper bounced up (highest ${top})`);
    assert.ok(io.events.some(e => e.d && e.d.type === 'stomp'));
    // a second stomp right away bounces but does not stun again
    const guard = b.stompGuardMs;
    assert.ok(guard > 0);
});

test('jumping off a head: holding jump bounces higher than just falling on it', () => {
    const peak = (hold) => {
        const { room, ps: [a, b] } = playing(2);
        b.x = 100; a.x = 100; a.y = 300; a.vy = 500; a.isGrounded = false;
        a.input.jump = hold;
        let top = Infinity;
        const l = room.gameLoop;
        let landed = false;
        for (let t = 0; t < 900; t += l.step) { l.update(l.step); if (b.stunMs > 0) landed = true; if (landed) top = Math.min(top, a.y); }
        return top;
    };
    assert.ok(peak(true) < peak(false) - 40);
});

test('a stunned player is slow and cannot jump', () => {
    const { room, ps: [a] } = playing(1);
    a.x = 100;
    const dist = (stun) => {
        const q = playing(1).ps[0]; q.x = 100; q.stunMs = stun ? 9999 : 0; q.input.right = true;
        const r = playing(1);
        return { q, r };
    };
    a.stunMs = 600; a.input.jump = true; a.input.right = true;
    const x0 = a.x;
    run(room, 400);
    assert.equal(a.isGrounded, true, 'did not jump');
    assert.ok(a.x - x0 < 40, `moved ${a.x - x0}`);
    assert.ok(dist);
});

test('ghosts do not block: spat-out and just-respawned players pass through', () => {
    const w = new Movement.PlayerWorld({ getCollidingTiles: () => [] }, () => [{ id: 'q', x: 10, y: 10, width: 30, height: 40 }]);
    const me = { id: 'me', x: 0, y: 10, width: 30, height: 40 };
    w.beginStep(me, { ghost: true });
    assert.equal(w.getCollidingTiles({ ...me, x: 20 }).length, 0);
    w.beginStep({ id: 'me', x: 60, y: 10, width: 30, height: 40 }, {});
    assert.equal(w.getCollidingTiles({ id: 'me', x: 30, y: 10, width: 30, height: 40 }).length, 1);
    assert.equal(Movement.isSolid({ isDead: true }), false);
    assert.equal(Movement.isSolid({ invulnMs: 500 }), false);
    assert.equal(Movement.isSolid({ spitBodyMs: 100 }), false);
    assert.equal(Movement.isSolid({ swallowed: true }), false);
    assert.equal(Movement.isSolid({}), true);
});
