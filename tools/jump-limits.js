// Measures how high/far a player can jump using the real Player physics.
const Player = require('../game/Player');
const level = { getCollidingTiles(p) { return p.y + p.height > 500 ? [{ x: -9999, y: 500, width: 99999, height: 999 }] : []; }, height: 720, switches: [] };
const room = { players: {}, level };

function jump(dir, holdMs, runUp) {
    const p = new Player('a', 'a', '#fff');
    p.reset(0, 460);
    p.vx = runUp ? dir * 250 : 0;
    p.isGrounded = true;
    p.input.jump = true; p.input.right = dir > 0; p.input.left = dir < 0;
    let t = 0, maxRise = 0, startY = p.y, lastX = p.x;
    const dt = 1000 / 60;
    let left = false;
    while (t < 3000) {
        p.update(dt, level, room);
        t += dt;
        if (t > 40) p.input.jump = false;
        if (t > holdMs) { p.input.right = false; p.input.left = false; }
        maxRise = Math.max(maxRise, startY - p.y);
        if (!p.isGrounded) left = true;
        if (left && p.isGrounded) break;
    }
    return { rise: maxRise, dist: Math.abs(p.x - 0), time: t };
}
let best = { rise: 0, dist: 0 };
for (const hold of [100, 400, 800, 1200, 3000]) {
    const r = jump(1, hold, true);
    console.log(`hold ${hold}ms run-up: rise ${r.rise.toFixed(1)} dist ${r.dist.toFixed(1)} air ${r.time.toFixed(0)}ms`);
    best = { rise: Math.max(best.rise, r.rise), dist: Math.max(best.dist, r.dist) };
}
const standing = jump(1, 3000, false);
console.log(`standing jump holding right: rise ${standing.rise.toFixed(1)} dist ${standing.dist.toFixed(1)}`);
console.log('MAX', best);
