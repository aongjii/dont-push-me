// Solvability checker: can a player get from spawn to the finish zone?
//
// It replays real jumps through the real Player physics from many start points on every
// platform (with and without a run-up, holding a direction for varying times) and records
// which platform each jump lands on. Switch-controlled platforms are treated as present
// (they can always be toggled on), spikes are ignored for the search itself. A BFS over that
// jump graph then says whether the finish can be reached.
const Player = require('../game/Player');
const Level = require('../game/Level');

const DT = 1000 / 60;

function makeWorld(level) {
    const plats = level.platforms; // all treated as active
    return {
        height: level.height,
        switches: [],
        getCollidingTiles(p) {
            return plats.filter(pl =>
                p.x < pl.x + pl.width && p.x + p.width > pl.x &&
                p.y < pl.y + pl.height && p.y + p.height > pl.y);
        }
    };
}

function standOn(world, plat, x) {
    const p = new Player('bot', 'bot', '#fff');
    p.reset(x, plat.y - p.height);
    p.isGrounded = true;
    return p;
}

function platformUnder(level, p) {
    const feet = p.y + p.height;
    return level.platforms.findIndex(pl =>
        Math.abs(pl.y - feet) < 1 && p.x + p.width > pl.x && p.x < pl.x + pl.width);
}

// Simulate one jump; returns index of the platform landed on (or -1)
function simulateJump(level, world, start, dir, runUp, holdMs, startPlat) {
    const p = standOn(world, level.platforms[startPlat], start);
    p.vx = runUp ? dir * 250 : 0;
    p.input.jump = true;
    p.input.left = dir < 0;
    p.input.right = dir > 0;
    const room = { players: {}, level: world };
    let t = 0, airborne = false;
    while (t < 2500) {
        p.update(DT, world, room);
        t += DT;
        if (t > 40) p.input.jump = false;
        if (t > holdMs) { p.input.left = false; p.input.right = false; }
        if (!p.isGrounded) airborne = true;
        if (airborne && p.isGrounded) return platformUnder(level, p);
        if (p.y > level.height + 200) return -1;
    }
    return -1;
}

function jumpGraph(level) {
    const world = makeWorld(level);
    const edges = level.platforms.map(() => new Set());
    level.platforms.forEach((pl, i) => {
        const xs = new Set();
        for (let x = pl.x; x <= pl.x + pl.width - 30; x += 15) xs.add(x);
        xs.add(pl.x + pl.width - 30);
        for (const x of xs) {
            for (const dir of [-1, 1]) {
                for (const runUp of [false, true]) {
                    for (const hold of [150, 300, 450, 600, 800, 1200]) {
                        const to = simulateJump(level, world, x, dir, runUp, hold, i);
                        if (to >= 0 && to !== i) edges[i].add(to);
                    }
                }
            }
        }
        // Walking/falling off an edge onto a lower platform also counts
        for (const side of [-1, 1]) {
            const p = standOn(world, pl, side < 0 ? pl.x - 29 : pl.x + pl.width - 1);
            p.isGrounded = false;
            p.input.right = side > 0; p.input.left = side < 0;
            const room = { players: {}, level: world };
            for (let t = 0; t < 2500; t += DT) {
                p.update(DT, world, room);
                if (p.isGrounded) { const to = platformUnder(level, p); if (to >= 0 && to !== i) edges[i].add(to); break; }
                if (p.y > level.height + 200) break;
            }
        }
    });
    return edges;
}

// Returns { solvable, reached: Set<platformIndex>, unreachable: platformIndex[], finishPlatforms }
function checkLevel(levelIndex) {
    const lv = new Level(levelIndex);
    const level = { platforms: lv.platforms, height: lv.height };
    const edges = jumpGraph(level);

    // spawn platform: the one the spawn point falls onto
    const world = makeWorld(level);
    const p = new Player('s', 's', '#fff');
    p.reset(lv.spawnX, lv.spawnY);
    const room = { players: {}, level: world };
    for (let t = 0; t < 4000 && !p.isGrounded; t += DT) p.update(DT, world, room);
    const startPlat = platformUnder(level, p);

    const reached = new Set([startPlat]);
    const queue = [startPlat];
    while (queue.length) {
        const cur = queue.shift();
        for (const n of edges[cur]) if (!reached.has(n)) { reached.add(n); queue.push(n); }
    }

    // finish is reachable if some reached platform's top is within a jump/walk of the zone
    const f = lv.finishZone;
    const finishPlatforms = level.platforms
        .map((pl, i) => ({ pl, i }))
        .filter(({ pl, i }) => reached.has(i) &&
            pl.x < f.x + f.width && pl.x + pl.width > f.x &&
            pl.y >= f.y && pl.y <= f.y + f.height + 130)
        .map(({ i }) => i);

    const unreachable = level.platforms.map((_, i) => i).filter(i => !reached.has(i));
    return { solvable: finishPlatforms.length > 0, reached, unreachable, startPlat, finishPlatforms, platformCount: level.platforms.length };
}

module.exports = { checkLevel, jumpGraph };

if (require.main === module) {
    const n = parseInt(process.argv[2] || '0', 10);
    const fs = require('fs'), path = require('path');
    const levels = n ? [n] : [1, 2, 3, 4, 5, 6, 7, 8].filter(i => fs.existsSync(path.join(__dirname, '..', 'game', 'levels', `level${i}.json`)));
    for (const i of levels) {
        const r = checkLevel(i);
        console.log(`level ${i}: ${r.solvable ? 'SOLVABLE' : 'NOT SOLVABLE'}  (${r.reached.size}/${r.platformCount} platforms reachable${r.unreachable.length ? ', unreachable: ' + r.unreachable.join(',') : ''})`);
    }
}
