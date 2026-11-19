// Bots. A bot plays the race by following a path of jumps planned from the real physics
// (see botnav.js): walk to the take-off point, run up if the jump needs it, press jump, steer
// in the air as the recipe says, then plan again from wherever it lands. It also gives rivals
// the odd shove, so it feels like a player and not a train on rails.
const botnav = require('./botnav');
const { MOVE } = require('../shared/movement');

const KEYS = ['left', 'right', 'jump', 'push', 'pull', 'interact', 'inhale', 'power'];
const navCache = new Map();

// Plans for one level: for every platform, the next jump towards the finish
function getNav(level) {
    const key = level.id;
    if (navCache.has(key)) return navCache.get(key);

    const platforms = level.platforms.map(p => ({ ...p, active: true }));
    const { recipes } = botnav.jumpGraph(platforms, level.height, { bot: true, hazards: level.hazards });

    const f = level.finishZone;
    const goals = platforms.map((pl, i) => i).filter(i => {
        const pl = platforms[i];
        return pl.x < f.x + f.width && pl.x + pl.width > f.x && pl.y >= f.y && pl.y <= f.y + f.height + 130;
    });

    // breadth-first search backwards from the goal platforms
    const rev = platforms.map(() => []);
    recipes.forEach(map => map.forEach(r => rev[r.to].push(r)));
    const dist = platforms.map(() => undefined);
    const next = platforms.map(() => null);
    const queue = [];
    goals.forEach(g => { dist[g] = 0; queue.push(g); });
    while (queue.length) {
        const node = queue.shift();
        for (const r of rev[node]) {
            if (dist[r.from] === undefined) {
                dist[r.from] = dist[node] + 1;
                next[r.from] = r;
                queue.push(r.from);
            }
        }
    }
    const nav = { dist, next, goals };
    navCache.set(key, nav);
    return nav;
}

class Bot {
    constructor(player, { rng = Math.random, aggression = 0.012, dummy = false } = {}) {
        this.p = player;
        this.rng = rng;
        this.aggression = aggression;
        this.dummy = dummy; // a dummy never moves (used for practice)
        this.state = { phase: 'idle' };
        this.waitedMs = 0; // how long we've been waiting for patrolling spikes to clear the landing spot
    }

    think(room, dt) {
        const p = this.p;
        const input = p.input;
        for (const k of KEYS) input[k] = false;
        if (this.dummy) return;

        if (p.isDead || p.isFinished || p.swallowedBy || p.pullDuration > 0) {
            this.state = { phase: 'idle' };
            return;
        }
        const level = room.level;
        if (!level || level.mode === 'survival') { this.survive(room); return; }

        const st = this.state;

        // In the air: keep steering as the recipe says
        if (!p.isGrounded) {
            if (st.phase === 'air') {
                st.airborneSeen = true;
                st.t += dt;
                if (st.t < st.holdMs) input[st.dir > 0 ? 'right' : 'left'] = true;
            }
            this.maybeShove(room);
            return;
        }

        // Just stepped off an edge / took off but hasn't left the ground yet: keep going
        if (st.phase === 'air' && !st.airborneSeen) {
            input[st.dir > 0 ? 'right' : 'left'] = true;
            return;
        }
        if (st.phase === 'air') this.state = { phase: 'idle' }; // landed

        const nav = getNav(level);
        const cur = botnav.platformUnder(level.platforms, p);
        if (cur < 0) return;


        // On a platform next to the finish: walk to it
        if (nav.dist[cur] === 0) {
            const f = level.finishZone;
            const dx = f.x + f.width / 2 - (p.x + p.width / 2);
            if (Math.abs(dx) > 6) input[dx > 0 ? 'right' : 'left'] = true;
            return;
        }

        const r = nav.next[cur];
        if (!r) { this.maybeShove(room); return; } // nowhere to go

        // The way on is switched off (someone cut a bridge): wait for it to come back
        if (!level.platforms[r.to].active) { this.state = { phase: 'idle' }; return; }

        if (r.kind === 'walkoff') {
            this.state = { phase: 'air', t: 0, holdMs: 1500, dir: r.dir, airborneSeen: false };
            input[r.dir > 0 ? 'right' : 'left'] = true;
            return;
        }

        const x = p.x;
        const dirKey = (d) => (d > 0 ? 'right' : 'left');

        // Patrolling spikes between us and where we're going: hop over them
        const heading = this.state.phase === 'run'
            ? r.dir
            : Math.sign((r.runUp ? r.startX - r.dir * botnav.RUNWAY : r.startX) - x);
        const ahead = this.hazardDistance(level, cur, p, heading);
        if (ahead !== null && ahead < 64) { this.hop(heading); return; }

        // Landing spot is under patrolling spikes right now: wait for them to move away
        if (r.kind === 'jump' && this.waitedMs < 5000 && this.dangerousLanding(level, r)) {
            this.waitedMs += dt; // ...but only for so long, then it takes its chances
            this.maybeShove(room);
            return;
        }

        // Lined up for take-off means: standing still on the take-off point (or, for a run-up jump,
        // standing still at the start of the runway). We steer by where we would stop if we let go now.
        const lineUp = (target) => {
            const err = target - (x + p.vx / 10);
            if (Math.abs(err) > 5) { input[dirKey(err)] = true; return false; }
            return Math.abs(p.vx) < 25;
        };

        if (r.runUp) {
            if (this.state.phase !== 'run') {
                if (!lineUp(r.startX - r.dir * botnav.RUNWAY)) {
                this.maybeShove(room);
                return;
            }
                this.state = { phase: 'run' };
            }
            input[dirKey(r.dir)] = true;
            const passed = r.dir > 0 ? x >= r.startX : x <= r.startX;
            if (!passed) return;
        } else if (!lineUp(r.startX)) {
            this.maybeShove(room);
            return;
        }

        // take off
        this.waitedMs = 0;
        input.jump = true;
        input[dirKey(r.dir)] = true;
        this.state = { phase: 'air', t: 0, holdMs: r.holdMs, dir: r.dir, airborneSeen: false };
    }

    // A short hop in direction `dir` (over spikes, or out of their way)
    hop(dir) {
        const p = this.p;
        p.input.jump = true;
        if (dir) p.input[dir > 0 ? 'right' : 'left'] = true;
        this.state = { phase: 'air', t: 0, holdMs: 450, dir: dir || 1, airborneSeen: false };
    }

    // Distance to the nearest patrolling hazard on this platform that lies in direction `heading`
    // (0 = any direction); null if none
    hazardDistance(level, cur, p, heading) {
        const plat = level.platforms[cur];
        let best = null;
        for (const h of level.hazards) {
            if (!(h.rangeX > 0)) continue;
            if (h.y + h.height < plat.y - 6 || h.y > plat.y + 6) continue;
            const diff = h.x + h.width / 2 - (p.x + p.width / 2);
            if (heading !== 0 && Math.sign(diff) !== heading) continue;
            const d = Math.abs(diff);
            if (best === null || d < best) best = d;
        }
        return best === null ? (heading === 0 ? 1e9 : null) : best;
    }

    // Would we land on top of a patrolling hazard? (predicts where it will be when we arrive)
    dangerousLanding(level, r) {
        const plat = level.platforms[r.to];
        for (const h of level.hazards) {
            if (!(h.rangeX > 0)) continue;
            if (h.y + h.height < plat.y - 6 || h.y > plat.y + 6) continue; // not on that platform
            const hx = h.startX + Math.sin((h.time + r.airMs / 1000) * (h.freq || 2)) * h.rangeX;
            if (Math.abs(hx + h.width / 2 - (r.landX + 15)) < h.width / 2 + 15 + 22) return true;
        }
        return false;
    }

    // Survival arenas: stay on the platform that will last longest, away from the edges
    survive(room) {
        const p = this.p;
        const input = p.input;
        const level = room.level;
        const cx = p.x + p.width / 2;
        const here = botnav.platformUnder(level.platforms, p);

        // Pick the sturdiest solid platform nearby and stand in its middle
        let best = null, bestScore = -Infinity;
        level.platforms.forEach((pl, i) => {
            if (!pl.active) return;
            const life = pl.crumbleAt === undefined ? 1e9 : pl.crumbleAt - room.roundElapsedMs();
            if (life < 1200) return; // about to fall
            const score = Math.min(life, 20000) - Math.abs(pl.x + pl.width / 2 - cx) * 4 - Math.abs(pl.y - p.y) * 2;
            if (score > bestScore) { bestScore = score; best = pl; }
        });
        if (best && p.isGrounded) {
            const tx = best.x + best.width / 2;
            const onIt = here >= 0 && level.platforms[here] === best;
            if (!onIt && Math.abs(tx - cx) > 8) {
                input[tx > cx ? 'right' : 'left'] = true;
                // hop over small gaps on the way
                if (this.rng() < 0.05) input.jump = true;
            } else if (Math.abs(tx - cx) > 60) {
                input[tx > cx ? 'right' : 'left'] = true;
            }
        }
        this.maybeShove(room);
    }

    // Now and then shove a rival who is right in front
    maybeShove(room) {
        const p = this.p;
        if (this.rng() > this.aggression) return;
        for (const q of Object.values(room.players)) {
            // bots only ever shove people, never each other (they'd knock one another off the course)
            if (q.id === p.id || q.isBot || q.isDead || q.isFinished || q.swallowedBy) continue;
            const dx = (q.x + q.width / 2) - (p.x + p.width / 2);
            if (Math.abs(q.y - p.y) < 30 && Math.abs(dx) < 60 && Math.sign(dx) === p.facing) {
                p.input.push = true;
                return;
            }
        }
    }
}

module.exports = { Bot, getNav };
