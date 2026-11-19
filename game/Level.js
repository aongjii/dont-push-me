const fs = require('fs');
const path = require('path');

// A switched platform that has been flipped away from its normal state returns by itself after
// this long, so nobody can be locked out of the rest of a (very long) level for good.
const CRUMBLE_AFTER_MS = 1200;     // how long you can stand on it before it gives way
const CRUMBLE_RESTORE_MS = 4000;    // ...and until it is back
const SWITCH_RESTORE_MS = 7000;

class Level {
    // levelIndex: a number (race levels: level1.json, ...) or a file name such as 'arena1'
    constructor(levelIndex) {
        this.levelIndex = levelIndex;
        this.id = String(levelIndex);
        this.width = 1600;
        this.height = 720;
        this.spawnX = 100;
        this.spawnY = 500;
        
        this.platforms = [];
        this.switches = [];
        this.hazards = [];
        this.items = []; // stars (eat for a random power) and orbs (hold and spit)
        this.checkpoints = []; // respawn flags: { x: centre, y: ground top }, in order of progress
        this.timeLimit = 90; // seconds (levels may override)
        this.theme = 'meadow'; // visual theme: meadow | candy | volcano
        this.mode = 'race'; // 'race' (reach the finish) or 'survival' (last one standing)
        this.finishZone = { x: 1500, y: 400, width: 60, height: 120 };
        this.lavaY = 900;
        this.hasRisingLava = false;
        this.lavaSpeed = 0;
        this.hints = [];
        this.zones = [];
        this.shooters = [];
        this.shots = [];
        this.shotId = 0;

        this.loadLevel(levelIndex);
    }

    loadLevel(levelIndex) {
        try {
            const file = typeof levelIndex === 'number' ? `level${levelIndex}` : String(levelIndex).replace(/[^a-z0-9_]/gi, '');
            const filepath = path.join(__dirname, 'levels', `${file}.json`);
            const rawData = fs.readFileSync(filepath, 'utf8');
            const data = JSON.parse(rawData);

            this.width = data.width || 1600;
            this.height = data.height || 720;
            this.spawnX = data.spawn?.x ?? 100;
            this.spawnY = data.spawn?.y ?? 500;
            this.finishZone = data.finish || { x: 1500, y: 400, width: 60, height: 120 };
            
            // Load platforms
            this.platforms = data.platforms.map(plat => ({
                x: plat.x,
                y: plat.y,
                width: plat.width,
                height: plat.height,
                active: plat.active !== undefined ? plat.active : true,
                initialActive: plat.active !== undefined ? plat.active : true,
                returnMs: 0, // > 0 while flipped away from its normal state: time until it comes back
                triggerIndex: plat.triggerIndex !== undefined ? plat.triggerIndex : null,
                color: plat.color || '#4A5568',
                // surface kinds (shared/movement.js reads bounce / ice / conveyor)
                bounce: !!plat.bounce,
                ice: !!plat.ice,
                conveyor: plat.conveyor || 0,    // px/s the belt carries you (negative = left)
                crumble: !!plat.crumble,         // drops away shortly after somebody stands on it
                crumbleAt: plat.crumbleAt === undefined ? null : plat.crumbleAt, // survival arenas: this platform collapses for good at this time (ms into the round)
                warn: false,
                blink: plat.blink ? { onMs: plat.blink.onMs, offMs: plat.blink.offMs, offsetMs: plat.blink.offsetMs || 0 } : null,
                phaseMs: 0,                      // blinking platforms: ms until the next switch
                weightMs: 0,                     // how long somebody has stood on it (builds up, eases off when empty)
                stoodOn: false
            }));

            // Load switches
            this.switches = (data.switches || []).map(sw => ({
                x: sw.x,
                y: sw.y,
                width: sw.width || 30,
                height: sw.height || 40,
                active: sw.active || false,
                initialActive: sw.active || false
            }));

            // Load hazards
            this.hazards = (data.hazards || []).map(haz => ({
                x: haz.x,
                y: haz.y,
                width: haz.width,
                height: haz.height,
                type: haz.type || 'spikes', // spikes, lava, moving
                vx: haz.vx || 0,
                vy: haz.vy || 0,
                rangeX: haz.rangeX || 0,
                rangeY: haz.rangeY || 0,
                startX: haz.x,
                startY: haz.y,
                freq: haz.freq || 2,    // patrol speed = range x freq (px/s)
                time: 0
            }));

            // Arrow / rock launchers. Each fires a harmful shot every intervalMs.
            this.hints = data.hints || [];
            // Areas that change the physics: wind (vx = px/s push) and low gravity (g = gravity multiplier)
            this.zones = (data.zones || []).map(z => ({ x: z.x, y: z.y, width: z.width, height: z.height, kind: z.kind || (z.g !== undefined ? 'moon' : 'wind'), vx: z.vx || 0, g: z.g !== undefined ? z.g : 1 }));
            this.shooters = (data.shooters || []).map((s, i) => ({
                x: s.x, y: s.y,
                vx: s.vx || 0, vy: s.vy || 0,
                width: s.width || 30, height: s.height || 14,
                kind: s.kind || (s.vy ? 'rock' : 'arrow'),
                intervalMs: s.intervalMs || 2400,
                lifeMs: s.lifeMs || 3000,
                timer: s.offsetMs !== undefined ? s.offsetMs : (i * 700) % (s.intervalMs || 2400)
            }));
            this.shots = [];
            this.shotId = 0;

            // Collectibles
            this.items = (data.items || []).map((it, i) => ({
                id: i,
                type: it.type === 'orb' ? 'orb' : 'star',
                x: it.x,
                y: it.y,
                homeX: it.x,
                homeY: it.y,
                alive: true,
                respawnMs: 0,
                beingPulled: false
            }));

            this.checkpoints = (data.checkpoints || []).map(c => ({ x: c.x, y: c.y }));
            this.timeLimit = data.timeLimit || 90;
            this.theme = data.theme || 'meadow';
            this.mode = data.mode === 'survival' ? 'survival' : 'race';

            // Rising lava
            this.hasRisingLava = data.hasRisingLava || false;
            this.lavaSpeed = data.lavaSpeed || 0;
            this.lavaY = data.lavaInitialY || this.height + 100;

        } catch (err) {
            console.error(`Error loading level ${levelIndex}:`, err);
            // Default fallback level
            this.platforms = [
                { x: 0, y: 600, width: 1600, height: 120, active: true, color: '#4A5568' }
            ];
            this.switches = [];
            this.hazards = [];
            this.finishZone = { x: 1500, y: 480, width: 60, height: 120 };
        }
    }

    // Flip a switch and every platform wired to it. Returns the switch's new state.
    toggleSwitch(idx) {
        const sw = this.switches[idx];
        if (!sw) return null;
        sw.active = !sw.active;
        this.platforms.forEach(p => {
            if (p.triggerIndex !== idx) return;
            p.active = !p.active;
            // away from its normal state -> it will come back on its own
            p.returnMs = p.active === p.initialActive ? 0 : SWITCH_RESTORE_MS;
        });
        return sw.active;
    }

    update(dt) {
        // Switched platforms that were flipped away go back to normal after a while
        this.platforms.forEach(p => {
            if (p.returnMs > 0) {
                p.returnMs -= dt;
                if (p.returnMs <= 0) {
                    p.returnMs = 0;
                    p.active = p.initialActive;
                    const sw = this.switches[p.triggerIndex];
                    if (sw) sw.active = sw.initialActive;
                }
            }
        });

        // Update hazards (e.g. moving platforms/hazards)
        this.hazards.forEach(haz => {
            if (haz.type === 'saw') {
                // a saw blade circling its centre
                haz.time += dt / 1000;
                haz.x = haz.startX + Math.sin(haz.time * haz.freq) * haz.rangeX;
                haz.y = haz.startY + Math.cos(haz.time * haz.freq) * haz.rangeY;
            } else if (haz.type === 'moving_spikes' || haz.type === 'moving_platform') {
                haz.time += dt / 1000;
                // Periodic ping-pong motion
                if (haz.rangeX > 0) {
                    haz.x = haz.startX + Math.sin(haz.time * haz.freq) * haz.rangeX;
                }
                if (haz.rangeY > 0) {
                    haz.y = haz.startY + Math.sin(haz.time * haz.freq) * haz.rangeY;
                }
            }
        });

        // Survival arenas collapse on a schedule (with a shaking warning first)
        this.elapsed = (this.elapsed || 0) + dt;
        this.platforms.forEach(p => {
            if (p.crumbleAt === null || !p.active) return;
            if (this.elapsed >= p.crumbleAt) { p.active = false; p.warn = false; p.returnMs = 0; }
            else p.warn = this.elapsed >= p.crumbleAt - 1500;
        });

        // Blinking platforms are solid for onMs, then gone for offMs, on a fixed clock
        this.blinkClock = (this.blinkClock || 0) + dt;
        this.platforms.forEach(p => {
            if (!p.blink) return;
            const cycle = p.blink.onMs + p.blink.offMs;
            const t = (this.blinkClock + p.blink.offsetMs) % cycle;
            p.active = t < p.blink.onMs;
            p.phaseMs = Math.round(p.active ? p.blink.onMs - t : cycle - t);
        });

        // Crumbling platforms: standing on one builds up weight; they only give way after a good while
        this.platforms.forEach(p => {
            if (!p.crumble || !p.active) return;
            if (p.stoodOn) p.weightMs += dt;
            else p.weightMs = Math.max(0, p.weightMs - dt * 0.7);
            p.stoodOn = false;
            if (p.weightMs >= CRUMBLE_AFTER_MS) {
                p.active = false;
                p.returnMs = CRUMBLE_RESTORE_MS;
                p.weightMs = 0;
            }
        });

        // Launchers
        const sec = dt / 1000;
        this.shooters.forEach(sh => {
            sh.timer -= dt;
            if (sh.timer <= 0) {
                sh.timer += sh.intervalMs;
                this.shots.push({ id: ++this.shotId, kind: sh.kind, x: sh.x, y: sh.y, vx: sh.vx, vy: sh.vy, width: sh.width, height: sh.height, ms: sh.lifeMs });
            }
        });
        this.shots.forEach(sh => { sh.x += sh.vx * sec; sh.y += sh.vy * sec; sh.ms -= dt; });
        this.shots = this.shots.filter(sh => sh.ms > 0);

        // Collectibles: drift home when released, come back after being eaten
        this.items.forEach(it => {
            if (!it.alive) {
                it.respawnMs -= dt;
                if (it.respawnMs <= 0) {
                    it.alive = true;
                    it.x = it.homeX;
                    it.y = it.homeY;
                }
            } else if (!it.beingPulled && (it.x !== it.homeX || it.y !== it.homeY)) {
                const dx = it.homeX - it.x, dy = it.homeY - it.y;
                const d = Math.hypot(dx, dy);
                const step = 220 * (dt / 1000);
                if (d <= step) { it.x = it.homeX; it.y = it.homeY; }
                else { it.x += (dx / d) * step; it.y += (dy / d) * step; }
            }
            it.beingPulled = false;
        });

        // Update rising lava
        if (this.hasRisingLava) {
            this.lavaY -= this.lavaSpeed * (dt / 1000);
        }
    }

    // Wind / low-gravity areas: what applies at the player's centre
    zoneAt(p) {
        const cx = p.x + p.width / 2, cy = p.y + p.height / 2;
        let vx = 0, g = 1, found = false;
        for (const z of this.zones) {
            if (cx >= z.x && cx <= z.x + z.width && cy >= z.y && cy <= z.y + z.height) {
                vx += z.vx; g = Math.min(g, z.g); found = true;
            }
        }
        return found ? { vx, g } : null;
    }

    // Called for every grounded player: standing on a crumbling platform builds up its weight
    touchGround(player) {
        for (const pl of this.platforms) {
            if (!pl.crumble || !pl.active) continue;
            if (Math.abs(pl.y - (player.y + player.height)) <= 2 &&
                player.x + player.width > pl.x && player.x < pl.x + pl.width) {
                pl.stoodOn = true;
            }
        }
    }

    getCollidingTiles(player) {
        const colliding = [];
        for (let plat of this.platforms) {
            if (!plat.active) continue;

            if (player.x < plat.x + plat.width &&
                player.x + player.width > plat.x &&
                player.y < plat.y + plat.height &&
                player.y + player.height > plat.y) {
                colliding.push(plat);
            }
        }
        return colliding;
    }

    checkHazards(player) {
        if (player.isDead || player.isFinished) return false;

        // Check rising lava
        if (this.hasRisingLava && player.y + player.height > this.lavaY) {
            return true;
        }

        for (const sh of this.shots) {
            if (player.x < sh.x + sh.width && player.x + player.width > sh.x &&
                player.y < sh.y + sh.height && player.y + player.height > sh.y) {
                return true;
            }
        }

        // Check normal static/moving hazards
        for (let haz of this.hazards) {
            if (player.x < haz.x + haz.width &&
                player.x + player.width > haz.x &&
                player.y < haz.y + haz.height &&
                player.y + player.height > haz.y) {
                return true;
            }
        }
        return false;
    }

    checkFinish(player) {
        if (player.isDead || player.isFinished) return false;

        const f = this.finishZone;
        return (player.x < f.x + f.width &&
                player.x + player.width > f.x &&
                player.y < f.y + f.height &&
                player.y + player.height > f.y);
    }
}

Level.SWITCH_RESTORE_MS = SWITCH_RESTORE_MS;
module.exports = Level;
