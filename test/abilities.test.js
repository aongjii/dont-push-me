const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');
const { ABILITY } = require('../game/abilities');

function fakeIo() {
    const events = [];
    return { events, to: () => ({ emit: (type, data) => events.push({ type, data }) }) };
}

// Room on level 1's open starting ground (x 0-250, floor at y=500), everyone placed in a row
function setup(n = 2) {
    const io = fakeIo();
    const room = new GameRoom('0000', io);
    for (let i = 0; i < n; i++) room.addPlayer(`p${i}`, `P${i}`);
    room.startGame();
    clearInterval(room.countdownInterval);
    room.countdownInterval = null;
    room.status = 'playing';
    room.level.items = [];
    room.roundTimeLeft = 1e9;
    const ps = Object.values(room.players);
    ps.forEach((p, i) => { p.x = 60 + i * 34; p.y = 460; p.facing = 1; p.isGrounded = true; });
    return { room, io, ps };
}

function run(room, ms) {
    const loop = room.gameLoop;
    for (let t = 0; t < ms && room.status === 'playing'; t += loop.step) loop.update(loop.step);
}

const effects = (io, type) => io.events.filter(e => e.data && e.data.type === type).map(e => e.data);

test('inhaling a star grants a power; the star comes back later', () => {
    const { room, ps: [a] } = setup(1);
    room.level.items = [{ id: 0, type: 'star', x: a.x + 80, y: a.y + 20, homeX: a.x + 80, homeY: a.y + 20, alive: true, respawnMs: 0 }];
    a.input.inhale = true;
    run(room, 1000);
    assert.ok(['fire', 'ice', 'spin', 'wings'].includes(a.power), `power: ${a.power}`);
    assert.equal(room.level.items[0].alive, false);

    a.input.inhale = false;
    run(room, ABILITY.starRespawn + 100);
    assert.equal(room.level.items[0].alive, true);
});

test('items outside the inhale cone are left alone', () => {
    const { room, ps: [a] } = setup(1);
    room.level.items = [{ id: 0, type: 'star', x: a.x + 400, y: a.y + 20, homeX: 0, homeY: 0, alive: true, respawnMs: 0 }];
    room.level.items[0].homeX = room.level.items[0].x; room.level.items[0].homeY = room.level.items[0].y;
    a.input.inhale = true;
    run(room, 600);
    assert.equal(a.power, null);
    assert.equal(room.level.items[0].alive, true);
});

test('an orb is held in the mouth, then spat as a projectile that knocks a rival back and credits the spitter', () => {
    const { room, ps: [a, b] } = setup(2);
    b.x = 200; // clear of the inhale cone
    room.level.items = [{ id: 0, type: 'orb', x: a.x + 80, y: a.y + 20, homeX: a.x + 80, homeY: a.y + 20, alive: true, respawnMs: 0 }];
    a.input.inhale = true;
    run(room, 800);
    assert.equal(a.mouth && a.mouth.kind, 'orb');

    a.input.inhale = false; run(room, 50);
    a.input.inhale = true;  run(room, 50); // press again = spit
    assert.equal(a.mouth, null);
    assert.equal(room.projectiles.length, 1);
    a.input.inhale = false;

    // step until the star lands, then check immediately (credit fades once the victim lands)
    for (let i = 0; i < 60 && room.projectiles.length > 0; i++) run(room, 16);
    assert.equal(room.projectiles.length, 0, 'projectile removed after hitting');
    assert.ok(b.vx > 0 || b.x > 200, 'rival was knocked away');
    assert.ok(b.hitCredit && b.hitCredit.by === 'p0');
});

test('a rival standing in front gets swallowed and rides in the mouth', () => {
    const { room, io, ps: [a, b] } = setup(2);
    a.input.inhale = true;
    run(room, 600);
    assert.equal(b.swallowedBy, 'p0');
    assert.deepEqual(a.mouth, { kind: 'player', id: 'p1' });
    assert.equal(effects(io, 'swallow').length, 1);

    a.input.inhale = false;
    a.input.right = true;
    run(room, 400);
    assert.ok(Math.abs(b.x - a.x) < 10, 'swallowed player follows the holder');
});

test('a swallowed player is immune to hazards and the finish line', () => {
    const { room, ps: [a, b] } = setup(2);
    a.input.inhale = true; run(room, 600); a.input.inhale = false;
    assert.equal(b.swallowedBy, 'p0');
    const f = room.level.finishZone;
    // move the holder far away; the carried player must not be able to finish on their own
    b.x = f.x; b.y = f.y;
    run(room, 50);
    assert.equal(b.isFinished, false);
    assert.equal(b.isDead, false);
});

test('spitting a swallowed player launches them; they bowl over a third player', () => {
    const { room, io, ps: [a, b, c] } = setup(3);
    c.x = 150;
    a.x = 60; b.x = 94;
    a.input.inhale = true; run(room, 600); a.input.inhale = false; run(room, 50);
    assert.equal(b.swallowedBy, 'p0');

    a.input.inhale = true; run(room, 50); a.input.inhale = false; // spit
    assert.equal(b.swallowedBy, null);
    assert.ok(b.spitBodyMs > 0);
    assert.ok(b.vx > 400);

    // it keeps flying: roughly speed x time, not a few pixels
    const x0 = b.x;
    run(room, 300);
    assert.ok(b.x - x0 > 100, `flew only ${b.x - x0}px`);

    for (let i = 0; i < 60 && !effects(io, 'push_hit').some(e => e.kind === 'spit'); i++) run(room, 16);
    assert.ok(effects(io, 'push_hit').some(e => e.kind === 'spit' && e.victim === 'p2'), 'third player was hit');
    assert.equal(c.hitCredit && c.hitCredit.by, 'p0', 'spitter gets the credit');
});

test('mashing keys frees a swallowed player', () => {
    const { room, io, ps: [a, b] } = setup(2);
    a.input.inhale = true; run(room, 600); a.input.inhale = false;
    assert.equal(b.swallowedBy, 'p0');

    for (let i = 0; i < ABILITY.escapeTaps; i++) {
        room.handleInput('p1', { left: true });
        room.handleInput('p1', { left: false });
    }
    assert.equal(b.swallowedBy, null);
    assert.equal(a.mouth, null);
    assert.equal(effects(io, 'escape').length, 1);

    // and can't be instantly re-swallowed
    a.input.inhale = true; run(room, 300);
    assert.equal(b.swallowedBy, null);
});

test('the mouth spits by itself after 3 seconds', () => {
    const { room, ps: [a, b] } = setup(2);
    a.input.inhale = true; run(room, 600); a.input.inhale = false;
    assert.equal(b.swallowedBy, 'p0');
    run(room, ABILITY.mouthMax + 200);
    assert.equal(b.swallowedBy, null);
    assert.equal(a.mouth, null);
});

test('if the holder dies, the swallowed player pops out', () => {
    const { room, ps: [a, b] } = setup(2);
    a.input.inhale = true; run(room, 600); a.input.inhale = false;
    a.die();
    room.handleDeath(a);
    run(room, 50);
    assert.equal(b.swallowedBy, null);
    assert.equal(b.isDead, false);
});

test('fire power shoots a fireball; powers expire', () => {
    const { room, ps: [a, b] } = setup(2);
    b.x = 160;
    a.gainPower('fire', room);
    a.input.push = true; run(room, 50); a.input.push = false;
    assert.equal(room.projectiles.length, 1);
    assert.equal(room.projectiles[0].type, 'fire');
    run(room, 500);
    assert.ok(b.vx > 0 || b.x > 160, 'fireball knocked the rival back');

    run(room, ABILITY.powerMs.fire);
    assert.equal(a.power, null);
});

test('ice power freezes a rival in front for 1s', () => {
    const { room, ps: [a, b] } = setup(2);
    b.x = 110;
    a.gainPower('ice', room);
    a.input.push = true; run(room, 50); a.input.push = false;
    assert.ok(b.pullDuration > 0);
    assert.equal(b.freezeKind, 'ice');
    run(room, ABILITY.iceFreeze + 200);
    assert.equal(b.pullDuration, 0);
});

test('spin power knocks nearby rivals away exactly once per spin', () => {
    const { room, io, ps: [a, b] } = setup(2);
    b.x = a.x + 20;
    a.gainPower('spin', room);
    a.input.push = true; run(room, 50); a.input.push = false;
    run(room, 200);
    assert.equal(effects(io, 'push_hit').filter(e => e.kind === 'spin').length, 1);
    assert.ok(Math.abs(b.vx) > 100 || Math.abs(b.x - a.x) > 40);
});

test('wings let you flap above a normal jump and glide down slowly', () => {
    const jumpPeak = (withWings) => {
        const { room, ps: [a] } = setup(1);
        if (withWings) a.gainPower('wings', room);
        const startY = a.y;
        let minY = startY;
        a.input.jump = true; run(room, 40); a.input.jump = false;
        for (let i = 0; i < 6; i++) { // tap jump again and again in the air
            run(room, 120);
            a.input.jump = true; run(room, 20); a.input.jump = false;
            minY = Math.min(minY, a.y);
        }
        return startY - minY;
    };
    assert.ok(jumpPeak(true) > jumpPeak(false) + 100, `${jumpPeak(true)} vs ${jumpPeak(false)}`);
});

test('wings power only helps while flying; F still pushes', () => {
    const { room, io, ps: [a, b] } = setup(2);
    a.gainPower('wings', room);
    a.input.push = true; run(room, 50); a.input.push = false;
    assert.equal(room.projectiles.length, 0);
    assert.ok(effects(io, 'push_hit').some(e => e.kind === undefined), 'normal push happened');
});

test('inhale is ignored while pulled, and a pulled victim cannot be inhaled-resisted state corrupted', () => {
    const { room, ps: [a] } = setup(1);
    a.pullDuration = 500;
    a.input.inhale = true;
    run(room, 200);
    assert.equal(a.inhaling, false);
});

test('level files declare collectibles', () => {
    const Level = require('../game/Level');
    for (const i of [1, 2, 3]) {
        const lv = new Level(i);
        assert.ok(Array.isArray(lv.items));
    }
});
