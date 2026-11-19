const test = require('node:test');
const assert = require('node:assert/strict');
const Movement = require('../shared/movement');
const Level = require('../game/Level');
const Player = require('../game/Player');

const DT = Movement.MOVE.step;
const worldOf = (platforms) => ({
    getCollidingTiles: (p) => platforms.filter(pl => p.x < pl.x + pl.width && p.x + p.width > pl.x && p.y < pl.y + pl.height && p.y + p.height > pl.y)
});
const stand = (plat, x = 100) => { const p = new Player('t', 't', '#fff'); p.reset(x, plat.y - p.height); p.isGrounded = true; return p; };
const run = (p, keys, world, ms) => { for (let t = 0; t < ms; t += DT) Movement.stepMovement(p, keys, DT, world, {}); };

test('bounce pad launches a player upward', () => {
    const pad = { x: 0, y: 500, width: 300, height: 100, bounce: true };
    const p = stand(pad);
    const world = worldOf([pad]);
    let top = p.y;
    for (let t = 0; t < 1500; t += DT) { Movement.stepMovement(p, {}, DT, world, {}); top = Math.min(top, p.y); }
    assert.ok(p.y < 500 - 40 - 150 || top < 500 - 40 - 150, `expected a big bounce, highest point was ${top}`);
});

test('ice makes you slide further than normal ground', () => {
    const slide = (extra) => {
        const floor = { x: 0, y: 500, width: 3000, height: 100, ...extra };
        const p = stand(floor, 100);
        const world = worldOf([floor]);
        run(p, { right: true }, world, 800);
        const x0 = p.x;
        run(p, {}, world, 1500);
        return p.x - x0;
    };
    assert.ok(slide({ ice: true }) > slide({}) * 3);
});

test('a conveyor belt carries a standing player', () => {
    const belt = { x: 0, y: 500, width: 1000, height: 100, conveyor: 120 };
    const p = stand(belt, 100);
    run(p, {}, worldOf([belt]), 1000);
    assert.ok(p.x > 100 + 90 && p.x < 100 + 140, `belt moved the player to ${p.x}`);
});

test('a conveyor cannot push a player through a wall', () => {
    const belt = { x: 0, y: 500, width: 1000, height: 100, conveyor: 200 };
    const wall = { x: 300, y: 300, width: 40, height: 200 };
    const p = stand(belt, 100);
    run(p, {}, worldOf([belt, wall]), 3000);
    assert.ok(p.x + p.width <= 300 + 0.01, `player is inside the wall at ${p.x}`);
});

test('crumbling platform survives a quick touch, drops after standing on it for a while, then comes back', () => {
    const lv = new Level(2);
    const pl = lv.platforms.find(x => x.crumble);
    assert.ok(pl, 'level 2 has a crumbling platform');
    const p = stand(pl, pl.x + 10);
    // a quick hop over it (0.4s) does nothing
    for (let t = 0; t < 400; t += 16) { lv.touchGround(p); lv.update(16); }
    assert.equal(pl.active, true);
    // ...and the weight eases off once you leave
    for (let t = 0; t < 1500; t += 16) lv.update(16);
    assert.equal(pl.weightMs, 0);
    // standing around for 2.2s brings it down
    for (let t = 0; t < 2200; t += 16) { lv.touchGround(p); lv.update(16); }
    assert.equal(pl.active, false, 'dropped away');
    for (let t = 0; t < 4200; t += 16) lv.update(16);
    assert.equal(pl.active, true, 'grew back');
});

test('shooters fire shots that hurt and then expire', () => {
    const lv = new Level(1);
    assert.ok(lv.shooters.length > 0);
    const sh = lv.shooters[0];
    for (let t = 0; t < sh.intervalMs + 100; t += 16) lv.update(16);
    assert.ok(lv.shots.length > 0, 'a shot was fired');
    const shot = lv.shots[0];
    const p = new Player('v', 'v', '#fff');
    p.reset(shot.x, shot.y - 10);
    assert.equal(lv.checkHazards(p), true);
    for (let t = 0; t < sh.lifeMs + 100; t += 16) lv.update(16);
    assert.ok(!lv.shots.some(s => s.id === shot.id), 'shot expired');
});

test('patrolling spikes keep a brisk pace (range x freq >= 90 px/s)', () => {
    for (const i of [1, 2, 3]) {
        const lv = new Level(i);
        for (const h of lv.hazards.filter(h => h.type === 'moving_spikes')) {
            assert.ok(h.rangeX * h.freq >= 90, `level ${i}: spikes only do ${h.rangeX * h.freq} px/s`);
        }
    }
});

const kindsOf = (lv) => {
    const kinds = new Set();
    lv.platforms.forEach(p => { if (p.bounce) kinds.add('bounce'); if (p.ice) kinds.add('ice'); if (p.conveyor) kinds.add('belt'); if (p.crumble) kinds.add('crumble'); });
    lv.shooters.forEach(s => kinds.add(s.kind));
    return kinds;
};

test('each level has its own set of obstacles, with nothing shared between levels', () => {
    const sets = [1, 2, 3].map(i => kindsOf(new Level(i)));
    sets.forEach((k, i) => assert.ok(k.size >= 2, `level ${i + 1} has only ${[...k]}`));
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
        const shared = [...sets[a]].filter(k => sets[b].has(k));
        assert.deepEqual(shared, [], `levels ${a + 1} and ${b + 1} share ${shared}`);
    }
});
