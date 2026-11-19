const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const GameRoom = require('../game/GameRoom');

function setup(n = 2, level = 1) {
    const events = [];
    const room = new GameRoom('0000', { to: () => ({ emit: (t, d) => events.push({ t, d }) }) });
    for (let i = 0; i < n; i++) room.addPlayer(`p${i}`, `P${i}`);
    room.startGame();
    clearInterval(room.countdownInterval);
    if (level !== 1) { // jump straight to another level
        room.levelIndex = level;
        room.startRound();
        clearInterval(room.countdownInterval);
    }
    room.countdownInterval = null;
    room.status = 'playing';
    room.level.items = [];
    room.roundTimeLeft = 1e9;
    return { room, events, ps: Object.values(room.players) };
}

const STEP = 1000 / 60;
const run = (room, ms) => { for (let t = 0; t < ms && room.status === 'playing'; t += STEP) room.gameLoop.update(STEP); };
const kill = (room, p) => { p.die(); room.handleDeath(p); };
const effects = (events, type) => events.filter(e => e.t === 'game_effect' && e.d.type === type).map(e => e.d);

test('dying costs a life: you wait, then come back at the start with a moment of safety', () => {
    const { room, ps: [a, b] } = setup();
    assert.equal(b.respawnsLeft, 2);
    kill(room, b);
    assert.equal(b.isDead, true);
    assert.equal(b.respawnsLeft, 1);
    assert.ok(b.respawnMs > 0);

    run(room, 2500);
    assert.equal(b.isDead, true, 'still waiting');
    run(room, 700);
    assert.equal(b.isDead, false, 'back after about 3 seconds');
    assert.ok(b.invulnMs > 0);
    assert.ok(Math.abs(b.x - (room.level.spawnX + 32)) < 5, `respawned at x=${b.x}`);
});

test('the round keeps going while someone is waiting to respawn', () => {
    const { room, ps: [a, b] } = setup();
    a.isFinished = true;
    kill(room, b);
    room.checkRoundEnd();
    assert.equal(room.status, 'playing');
    run(room, 3200);
    assert.equal(b.isDead, false);
    assert.equal(room.status, 'playing', 'they are back in the race');
});

test('after the third death you are out, and the round can end', () => {
    const { room, events, ps: [a, b] } = setup();
    a.isFinished = true;
    for (let life = 0; life < 3; life++) {
        assert.equal(b.isDead, false, `alive for life ${life + 1}`);
        kill(room, b);
        run(room, 3300);
    }
    assert.equal(b.isDead, true);
    assert.equal(b.respawnMs, 0);
    assert.equal(room.status, 'round_end');
    assert.equal(effects(events, 'player_died').filter(e => e.willRespawn).length, 2);
});

test('lives are shown in the state: 3, 2, 1, then 0 when out', () => {
    const { room, events, ps: [a, b] } = setup();
    const livesOf = () => { const n = events.length; room.broadcastState(); return events.slice(n).find(e => e.t === 'game_state').d.players.find(p => p.id === 'p1').lives; };
    assert.equal(livesOf(), 3);
    kill(room, b); assert.equal(livesOf(), 2);
    run(room, 3300);
    kill(room, b); assert.equal(livesOf(), 1);
    run(room, 3300);
    kill(room, b); assert.equal(livesOf(), 0);
});

test('reaching a checkpoint saves it, and you respawn there (the furthest one)', () => {
    const { room, events, ps: [a, b] } = setup();
    const cps = room.level.checkpoints;
    assert.ok(cps.length >= 3);

    const standAt = (cp) => { b.x = cp.x - 15; b.y = cp.y - 40; b.vx = b.vy = 0; run(room, 100); };
    standAt(cps[0]);
    assert.equal(b.cpIndex, 0);
    standAt(cps[1]);
    assert.equal(b.cpIndex, 1);
    standAt(cps[0]); // going back does not lower it
    assert.equal(b.cpIndex, 1);
    assert.equal(effects(events, 'checkpoint').length, 2);

    kill(room, b);
    run(room, 3300);
    assert.ok(Math.abs(b.x - (cps[1].x - 15)) < 5, `respawned at ${b.x}, wanted ${cps[1].x - 15}`);
    assert.ok(b.y < cps[1].y + 5, 'on the flag, not underground');
});

test('far-away checkpoints are not triggered by flying past them', () => {
    const { room, ps: [a, b] } = setup();
    const cp = room.level.checkpoints[0];
    b.x = cp.x - 15; b.y = cp.y - 400; // high above the flag
    room.updateCheckpoints(b);
    assert.equal(b.cpIndex, -1);
});

test('after respawning, spikes cannot hurt for 2 seconds, then they can again', () => {
    const { room, ps: [a, b] } = setup();
    kill(room, b);
    run(room, 3300);
    assert.equal(b.isDead, false);
    // put a spike right on top of them
    room.level.hazards = [{ x: b.x - 20, y: b.y - 20, width: 100, height: 100, type: 'spikes' }];
    run(room, 1000);
    assert.equal(b.isDead, false, 'invulnerable');
    run(room, 1500);
    assert.equal(b.isDead, true, 'vulnerable again');
});

test('respawning clears powers, mouth contents and freezes', () => {
    const { room, ps: [a, b] } = setup();
    b.gainPower('fire', room);
    b.pullDuration = 500;
    kill(room, b);
    run(room, 3300);
    assert.equal(b.power, null);
    assert.equal(b.pullDuration, 0);
    assert.equal(b.isDead, false);
});

test('the KO bonus still goes to whoever sent them off, every time', () => {
    const { room, ps: [a, b] } = setup();
    for (let i = 0; i < 2; i++) {
        b.markHit(a);
        kill(room, b);
        run(room, 3300);
    }
    assert.equal(a.roundKos, 2);
});

test('rising lava: you respawn above it, or are out if it already covered every safe spot', () => {
    const { room, ps: [a, b] } = setup(2, 3);
    assert.ok(room.level.hasRisingLava);
    const cps = room.level.checkpoints;
    b.cpIndex = 1;

    // lava is far below: the checkpoint is fine
    room.level.lavaY = cps[1].y + 1000;
    assert.ok(room.pickRespawn(b));

    // lava has climbed past that flag, so use an earlier one if it is still above the lava... none are
    room.level.lavaY = cps[0].y - 500;
    assert.equal(room.pickRespawn(b), null);
    b.respawnsLeft = 2;
    kill(room, b);
    assert.equal(b.respawnMs, 0, 'no safe spot, so no respawn is scheduled');
    assert.equal(b.respawnsLeft, 2, 'and the life is not spent');
});

test('lava that rises during the wait can cancel the respawn', () => {
    const { room, ps: [a, b] } = setup(2, 3);
    b.cpIndex = 0;
    room.level.lavaY = room.level.checkpoints[0].y + 600;
    kill(room, b);
    assert.ok(b.respawnMs > 0);
    room.level.lavaY = room.level.checkpoints[0].y - 300; // lava swallows the flag while they wait
    run(room, 3300);
    assert.equal(b.isDead, true);
    assert.equal(b.respawnMs, 0);
});

test('falling off the map costs a life and respawns too', () => {
    const { room, ps: [a, b] } = setup();
    b.x = -800; b.y = 100;
    run(room, 3000);
    assert.equal(b.isDead, true);
    assert.equal(b.respawnsLeft, 1);
    run(room, 3500);
    assert.equal(b.isDead, false);
});

test('level files: every checkpoint stands on solid, non-removable ground, in order of progress', () => {
    const dir = path.join(__dirname, '..', 'game', 'levels');
    for (const f of fs.readdirSync(dir).filter(n => /^level\d+\.json$/.test(n))) {
        const lv = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        assert.ok(lv.checkpoints && lv.checkpoints.length >= 3, `${f}: needs checkpoints`);
        const vertical = lv.height > lv.width;
        let prev = null;
        for (const cp of lv.checkpoints) {
            const ground = lv.platforms.find(p => p.triggerIndex === undefined && p.active !== false &&
                cp.x > p.x + 20 && cp.x < p.x + p.width - 20 && p.y === cp.y);
            assert.ok(ground, `${f}: checkpoint at (${cp.x}, ${cp.y}) is not on solid ground`);
            if (prev) assert.ok(vertical ? cp.y < prev.y : cp.x > prev.x, `${f}: checkpoints out of order`);
            prev = cp;
        }
    }
});
