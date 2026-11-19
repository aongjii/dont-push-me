// Navigation for bots (and the level solvability checker): which platform can you jump to from
// which, and exactly how. Every jump is tried through the real movement physics, so a recipe that
// is found here really works in the game.
const Player = require('./Player');
const Movement = require('../shared/movement');

const DT = Movement.MOVE.step;
const RUNWAY = 90;           // a run-up jump needs this much platform behind the take-off point
const HOLDS = [150, 300, 450, 600, 800, 1200, 1700];

// planning treats a bounce pad as ordinary floor
const plain = pl => (pl.bounce ? { ...pl, bounce: false } : pl);

function makeWorld(platforms, height, zones = []) {
    return {
        height,
        switches: [],
        zoneAt(p) {
            const cx = p.x + p.width / 2, cy = p.y + p.height / 2;
            let vx = 0, g = 1, found = false;
            for (const z of zones) {
                if (cx >= z.x && cx <= z.x + z.width && cy >= z.y && cy <= z.y + z.height) { vx += z.vx; g = Math.min(g, z.g); found = true; }
            }
            return found ? { vx, g } : null;
        },
        getCollidingTiles(p) {
            return platforms.filter(pl =>
                p.x < pl.x + pl.width && p.x + p.width > pl.x &&
                p.y < pl.y + pl.height && p.y + p.height > pl.y).map(plain);
        }
    };
}

function platformUnder(platforms, p) {
    const feet = p.y + p.height;
    return platforms.findIndex(pl =>
        Math.abs(pl.y - feet) < 1 && p.x + p.width > pl.x && p.x < pl.x + pl.width);
}

function standOn(plat, x) {
    const p = new Player('nav', 'nav', '#fff');
    p.reset(x, plat.y - p.height);
    p.isGrounded = true;
    return p;
}

// One jump through the real physics. Returns { to, x, ms }: the platform it lands on, where, and
// how long it was in the air (or null if it never lands on a platform).
function jumpOutcome(platforms, world, height, startPlat, startX, dir, runUp, holdMs) {
    const p = standOn(platforms[startPlat], startX);
    // a bot that has run 90px from standstill is at ~96% of top speed, so plan for that
    p.vx = runUp ? dir * Movement.MOVE.speed * 0.96 : 0;
    const keys = { jump: true, left: dir < 0, right: dir > 0 };
    let t = 0, airborne = false;
    while (t < 2500) {
        Movement.stepMovement(p, keys, DT, world, {});
        t += DT;
        if (t > 40) keys.jump = false;
        if (t > holdMs) { keys.left = false; keys.right = false; }
        if (!p.isGrounded) airborne = true;
        if (airborne && p.isGrounded) {
            const to = platformUnder(platforms, p);
            return to < 0 ? null : { to, x: p.x, ms: t };
        }
        if (p.y > height + 200) return null;
    }
    return null;
}

function simulateJump(platforms, world, height, startPlat, startX, dir, runUp, holdMs) {
    const o = jumpOutcome(platforms, world, height, startPlat, startX, dir, runUp, holdMs);
    return o ? o.to : -1;
}

// Walk off an edge (no jump) and land somewhere lower
function simulateWalkOff(platforms, world, height, startPlat, side) {
    const pl = platforms[startPlat];
    const p = standOn(pl, side < 0 ? pl.x - 29 : pl.x + pl.width - 1);
    p.isGrounded = false;
    const keys = { left: side < 0, right: side > 0 };
    for (let t = 0; t < 2500; t += DT) {
        Movement.stepMovement(p, keys, DT, world, {});
        if (p.isGrounded) return platformUnder(platforms, p);
        if (p.y > height + 200) return -1;
    }
    return -1;
}

// Builds the jump graph. `bot: true` keeps only recipes a bot can actually perform (there must
// be room to run up, and the jump must still work if it starts a few pixels off).
// Returns { edges: Array<Set<number>>, recipes: Array<Map<number, recipe>> }.
function jumpGraph(platforms, height, { bot = false, hazards = [], zones = [] } = {}) {
    const world = makeWorld(platforms, height, zones);
    const edges = platforms.map(() => new Set());
    const recipes = platforms.map(() => new Map());

    platforms.forEach((pl, i) => {
        const xs = new Set();
        for (let x = pl.x; x <= pl.x + pl.width - 30; x += 15) xs.add(x);
        xs.add(pl.x + pl.width - 30);

        for (const x of xs) {
            for (const dir of [-1, 1]) {
                for (const runUp of [false, true]) {
                    if (bot && runUp) {
                        const runway = dir > 0 ? x - pl.x : (pl.x + pl.width - 30) - x;
                        if (runway < RUNWAY) continue;
                    }
                    for (const hold of HOLDS) {
                        const outcome = jumpOutcome(platforms, world, height, i, x, dir, runUp, hold);
                        const to = outcome ? outcome.to : -1;
                        if (to < 0 || to === i) continue;
                        edges[i].add(to);
                        if (!bot) continue;

                        // Prefer the jump that lands deepest on the target: grazing its edge is how
                        // you get pushed back off it by the corner-collision rules.
                        const target = platforms[to];
                        const centre = outcome.x + 15;
                        let margin = Math.min(centre - target.x, target.x + target.width - centre);
                        // ...and never into the band where patrolling spikes sweep, if there's any alternative
                        for (const h of hazards) {
                            if (!(h.rangeX > 0) || h.y + h.height < target.y - 6 || h.y > target.y + 6) continue;
                            const lo = h.startX - h.rangeX, hi = h.startX + h.rangeX + h.width;
                            if (outcome.x + 30 > lo && outcome.x < hi) margin -= 1000;
                        }
                        const existing = recipes[i].get(to);
                        if (existing && existing.margin >= margin) continue;

                        // robust? must still land on the same platform from nearby start points
                        const lo = Math.max(pl.x, x - 6), hi = Math.min(pl.x + pl.width - 30, x + 6);
                        const robust = [lo, hi].every(sx => simulateJump(platforms, world, height, i, sx, dir, runUp, hold) === to);
                        if (robust) recipes[i].set(to, { kind: 'jump', from: i, to, startX: x, dir, runUp, holdMs: hold, landX: outcome.x, airMs: outcome.ms, margin });
                    }
                }
            }
        }

        // stepping off either side
        for (const side of [-1, 1]) {
            const to = simulateWalkOff(platforms, world, height, i, side);
            if (to >= 0 && to !== i) {
                edges[i].add(to);
                if (bot && !recipes[i].has(to)) recipes[i].set(to, { kind: 'walkoff', from: i, to, dir: side });
            }
        }
    });
    return { edges, recipes };
}

module.exports = { makeWorld, platformUnder, simulateJump, jumpOutcome, jumpGraph, RUNWAY };
