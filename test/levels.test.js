const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Level = require('../game/Level');
const { checkLevel } = require('../tools/reach');

const dir = path.join(__dirname, '..', 'game', 'levels');
const indexes = fs.readdirSync(dir).map(f => /^level(\d+)\.json$/.exec(f)).filter(Boolean).map(m => +m[1]).sort();

test('there are at least 3 levels', () => {
    assert.ok(indexes.length >= 3);
});

for (const i of indexes) {
    test(`level ${i}: every platform is reachable and the finish can be reached from spawn`, () => {
        const r = checkLevel(i);
        assert.ok(r.solvable, `level ${i} cannot be finished`);
        assert.deepEqual(r.unreachable, [], `unreachable platforms: ${r.unreachable}`);
    });

    test(`level ${i}: data is well formed`, () => {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, `level${i}.json`), 'utf8'));
        const lv = new Level(i);

        // every removable platform has a switch, and every switch drives a platform
        const triggers = raw.platforms.filter(p => p.triggerIndex !== undefined).map(p => p.triggerIndex).sort((a, b) => a - b);
        assert.deepEqual(triggers, raw.switches.map((_, idx) => idx), 'platform triggers and switches do not pair up');

        // everything is inside the level bounds
        for (const p of raw.platforms) {
            assert.ok(p.x >= 0 && p.x + p.width <= raw.width, `platform out of bounds at x=${p.x}`);
            assert.ok(p.y >= 0 && p.y <= raw.height, `platform out of bounds at y=${p.y}`);
        }
        for (const it of raw.items) {
            assert.ok(['star', 'orb'].includes(it.type));
            assert.ok(it.x > 0 && it.x < raw.width && it.y > 0 && it.y < raw.height, 'item out of bounds');
        }

        // the spawn point is clear of hazards, and the finish is inside the level
        assert.ok(raw.finish.x + raw.finish.width <= raw.width);
        const f = lv.finishZone;
        assert.ok(f.y >= 0 && f.y + f.height <= raw.height);
        assert.ok(lv.timeLimit >= 60);
        assert.ok(lv.items.length >= 4, 'levels should have a few collectibles');
        assert.ok(lv.items.some(it => it.type === 'star'));
    });
}

test('new levels are meaningfully longer than the originals (1600px / 800px-wide tower)', () => {
    for (const i of [1, 2]) assert.ok(new Level(i).width >= 5000, `level ${i} width ${new Level(i).width}`);
    assert.ok(new Level(3).height >= 3000);
});

test('the tutorial level can be finished and every hint is in the level', () => {
    const r = checkLevel('tutorial');
    assert.ok(r.solvable, 'tutorial cannot be finished');
    assert.deepEqual(r.unreachable, []);
    const lv = new Level('tutorial');
    assert.ok(lv.hints.length >= 5);
    lv.hints.forEach(h => assert.ok(h.x >= 0 && h.x < lv.width));
    for (let i = 1; i < lv.hints.length; i++) assert.ok(lv.hints[i].x >= lv.hints[i - 1].x, 'hints must be in order of x');
});
