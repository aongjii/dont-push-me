const fs = require('fs');
const path = require('path');

// A switched platform that has been flipped away from its normal state returns by itself after
// this long, so nobody can be locked out of the rest of a (very long) level for good.
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
                color: plat.color || '#4A5568'
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
                time: 0
            }));

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
            if (haz.type === 'moving_spikes' || haz.type === 'moving_platform') {
                haz.time += dt / 1000;
                // Periodic ping-pong motion
                if (haz.rangeX > 0) {
                    haz.x = haz.startX + Math.sin(haz.time * 2) * haz.rangeX;
                }
                if (haz.rangeY > 0) {
                    haz.y = haz.startY + Math.sin(haz.time * 2) * haz.rangeY;
                }
            }
        });

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
