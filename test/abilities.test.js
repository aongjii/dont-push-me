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
    a.input.power = true; run(room, 50); a.input.power = false;
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
    a.input.power = true; run(room, 50); a.input.power = false;
    assert.ok(b.pullDuration > 0);
    assert.equal(b.freezeKind, 'ice');
    run(room, ABILITY.iceFreeze + 200);
    assert.equal(b.pullDuration, 0);
});

test('spin power knocks nearby rivals away exactly once per spin', () => {
    const { room, io, ps: [a, b] } = setup(2);
    b.x = a.x + 20;
    a.gainPower('spin', room);
    a.input.power = true; run(room, 50); a.input.power = false;
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


// ---------- Balance: surviving a spit, limited wings, spit cooldown ----------
const Movement = require('../shared/movement');

// Spat from the edge of the ground over a pit (the bridge is cut). Returns whether the victim lives.
function spitOverPit(react) {
    const { room, ps: [a, b] } = setup(2);
    room.level.hazards = [{ x: 320, y: 660, width: 380, height: 60, type: 'spikes' }];
    room.level.platforms.forEach(p => { if (p.triggerIndex === 0) p.active = false; });
    a.x = 262; a.y = 460; a.facing = 1; b.x = 262; b.y = 460;
    a.swallow(b, room);
    a.spit(room);
    for (let t = 0; t < 3500 && !b.isDead && !(b.isGrounded && t > 150); t += 16.67) {
        react(b, t);
        room.gameLoop.update(16.67);
    }
    return !b.isDead;
}

test('a player spat over a pit dies if they do nothing', () => {
    assert.equal(spitOverPit(() => {}), false);
});

test('a player spat over a pit can survive: hop to brake, then walk back', () => {
    const survives = spitOverPit((b, t) => { b.input.jump = t >= 100 && t < 150; b.input.left = t >= 100; });
    assert.equal(survives, true);
});

test('the escape window is forgiving: pressing hop up to ~0.5s after the spit still works', () => {
    for (const at of [0, 150, 300, 450, 550]) {
        const ok = spitOverPit((b, t) => { b.input.jump = t >= at && t < at + 50; b.input.left = t >= at; });
        assert.equal(ok, true, `hop pressed ${at}ms after the spit was too late`);
    }
});

test('the recovery hop works once, then is spent', () => {
    const { room, ps: [a, b] } = setup(2);
    a.x = 262; a.facing = 1; b.x = 262;
    a.swallow(b, room); a.spit(room);
    assert.equal(b.recover, 1);
    let hops = 0;
    room.io.events.length = 0;
    for (let t = 0; t < 700; t += 16.67) {
        b.input.jump = Math.floor(t / 100) % 2 === 0; // mash jump
        room.gameLoop.update(16.67);
    }
    hops = effects(room.io, 'recover').length;
    assert.equal(hops, 1);
    assert.equal(b.recover === 0 || b.isGrounded, true);
});

test('a spat-out player is no longer under server control (they can steer after the first moments)', () => {
    const { room, ps: [a, b] } = setup(2);
    a.x = 262; b.x = 262; a.swallow(b, room); a.spit(room);
    assert.equal(b.serverControlled(), false);
    // just after launch: ballistic (ignores steering)
    assert.equal(b.movementMods().ballistic, true);
    run(room, 300);
    assert.equal(b.movementMods().ballistic, false);
});

test('the spitter cannot inhale again straight away', () => {
    const { room, ps: [a, b] } = setup(2);
    a.swallow(b, room); a.spit(room);
    assert.ok(a.inhaleCd > 0);
    a.input.inhale = true;
    run(room, 200);
    assert.equal(a.inhaling, false);
    run(room, 1000);
    assert.equal(a.inhaling, true);
});

test('wings give a limited number of flaps, then only gliding', () => {
    const { room, ps: [a] } = setup(1);
    a.gainPower('wings', room);
    assert.equal(a.flaps, Movement.MOVE.flapsPerPower);
    // lift off, then tap jump as fast as allowed
    a.input.jump = true; run(room, 40); a.input.jump = false;
    let flaps = 0;
    for (let i = 0; i < 40; i++) {
        run(room, 100);
        a.input.jump = true; run(room, 20); a.input.jump = false;
    }
    flaps = effects(room.io, 'flap').length;
    assert.equal(flaps, Movement.MOVE.flapsPerPower, 'flapped more than allowed');
    assert.equal(a.flaps, 0);
});

test('getting a new wings power refills the flaps; other powers have none', () => {
    const { room, ps: [a] } = setup(1);
    a.gainPower('wings', room);
    a.flaps = 1;
    a.gainPower('wings', room);
    assert.equal(a.flaps, Movement.MOVE.flapsPerPower);
    a.gainPower('fire', room);
    assert.equal(a.flaps, 0);
});

// ---------- Charged spit: the longer you hold, the harder it goes ----------
test('spitting later launches the swallowed player harder (and they hit harder)', () => {
    const launch = (holdMs) => {
        const { room, ps: [a, b] } = setup(2);
        a.x = 262; b.x = 262; a.facing = 1;
        a.swallow(b, room);
        run(room, holdMs);
        if (a.mouth) a.spit(room);
        return { vx: b.vx, knock: b.spitKnockSpeed };
    };
    const quick = launch(0);
    const held = launch(2500);
    assert.ok(held.vx > quick.vx * 1.5, `held ${held.vx} vs quick ${quick.vx}`);
    assert.ok(held.knock > quick.knock * 1.5);
    assert.ok(quick.vx > 400, 'even a quick spit is strong');
});

test('the charge grows with time and is capped at 1; it is part of the state sent to players', () => {
    const { room, io, ps: [a, b] } = setup(2);
    const events = io.events;
    a.swallow(b, room);
    assert.equal(a.mouthCharge(), 0);
    run(room, 1500);
    const mid = a.mouthCharge();
    assert.ok(mid > 0.4 && mid < 0.6, `charge after 1.5s: ${mid}`);
    const n = events.length;
    room.broadcastState();
    const state = events.slice(n).find(e => e.type === 'game_state').data;
    assert.ok(Math.abs(state.players.find(p => p.id === 'p0').charge - mid) < 0.05);
    run(room, 5000); // auto-spits at 3s
    assert.equal(a.mouth, null);
    assert.equal(a.mouthCharge(), 0);
});

test('a held orb is also spat harder: faster star that knocks further', () => {
    const shoot = (holdMs) => {
        const { room, ps: [a, b] } = setup(2);
        b.x = 400;
        a.mouth = { kind: 'orb' }; a.mouthMs = 3000;
        run(room, holdMs);
        a.spit(room);
        return room.projectiles[0];
    };
    const quick = shoot(0), held = shoot(2500);
    assert.ok(Math.abs(held.vx) > Math.abs(quick.vx) * 1.5);
    assert.ok(held.power > quick.power);
});

test('the spit effect tells clients how charged it was', () => {
    const { room, io, ps: [a, b] } = setup(2);
    a.swallow(b, room);
    run(room, 2000);
    a.spit(room);
    const ev = io.events.filter(e => e.data && e.data.type === 'spit').pop().data;
    assert.ok(ev.charge > 0.5);
});

test('even a fully charged spit over a pit leaves a (short) window to survive', () => {
    const attempt = (holdMs, hopAt) => {
        const { room, ps: [a, v] } = setup(2);
        room.level.hazards = [{ x: 320, y: 660, width: 380, height: 60, type: 'spikes' }];
        room.level.platforms.forEach(p => { if (p.triggerIndex === 0) p.active = false; });
        room.level.platforms.push({ x: 700, y: 500, width: 400, height: 220, active: true, triggerIndex: null });
        a.x = 262; a.y = 460; a.facing = 1; v.x = 262; v.y = 460;
        a.swallow(v, room);
        run(room, holdMs);
        a.x = 262; a.y = 460; a.vx = 0; a.vy = 0;
        a.spit(room);
        for (let t = 0; t < 3500 && !v.isDead && !(v.isGrounded && t > 150); t += 16.67) {
            v.input.jump = t >= hopAt && t < hopAt + 50;
            v.input.left = t >= hopAt;
            room.gameLoop.update(16.67);
        }
        return !v.isDead;
    };
    assert.equal(attempt(2900, 100), true, 'quick reaction after a fully charged spit saves you');
    assert.equal(attempt(2900, 1500), false, 'doing it far too late does not');
    assert.equal(attempt(1500, 300), true);
});
