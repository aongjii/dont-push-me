// Kirby-style abilities for Player: inhale things, swallow rivals, spit them out as
// projectiles, and eat stars for a random temporary power. Installed onto Player.prototype.

const POWERS = ['fire', 'ice', 'spin', 'wings'];

const ABILITY = {
    inhaleRange: 150,
    inhaleHalfHeight: 42,
    itemPullSpeed: 430,    // px/s items fly toward the mouth
    playerPullSpeed: 170,  // px/s rivals are dragged (they can still run away at 250)
    swallowDist: 30,
    mouthMax: 3000,        // ms before the mouth spits on its own
    escapeTaps: 6,         // key presses a swallowed player needs to wriggle free
    swallowImmunity: 1500, // after being freed, can't be swallowed again for a bit

    spitSpeed: 720,
    spitBodySpeed: 520,
    spitBodyMs: 700,       // a spat-out player is a living bowling ball this long
    spitKnock: 560,

    powerMs: { fire: 15000, ice: 15000, spin: 15000, wings: 10000 },
    powerCooldown: { fire: 500, ice: 1600, spin: 1800 },
    fireSpeed: 520,
    iceRange: 150,
    iceFreeze: 1000,
    spinMs: 800,
    spinRadius: 55,
    spinKnock: 620,
    spinSpeedBoost: 1.25,

    flapForce: -380,
    flapCooldown: 280,
    glideFall: 110,

    starRespawn: 15000,
    orbRespawn: 8000
};

function isTargetable(p, self) {
    return p.id !== self.id && !p.isDead && !p.isFinished && !p.swallowedBy;
}

function install(Player) {
    Object.assign(Player.prototype, {
        mouthPoint() {
            return {
                x: this.x + this.width / 2 + this.facing * (this.width / 2 + 6),
                y: this.y + this.height * 0.5
            };
        },

        gainPower(type, room) {
            this.power = type;
            this.powerMs = ABILITY.powerMs[type];
            if (room) room.broadcastEffect('power_gain', { id: this.id, name: this.name, power: type });
        },

        // Called every tick while the inhale key is held and the mouth is empty
        performInhale(dt, room) {
            const level = room.level;
            const m = this.mouthPoint();
            const left = this.facing === 1 ? this.x + this.width : this.x - ABILITY.inhaleRange;
            const right = left + ABILITY.inhaleRange;
            const inCone = (cx, cy) =>
                cx >= left && cx <= right && Math.abs(cy - m.y) <= ABILITY.inhaleHalfHeight;

            // Items (stars to eat, orbs to hold and spit)
            for (const it of level.items || []) {
                if (!it.alive || !inCone(it.x, it.y)) continue;
                const dx = m.x - it.x, dy = m.y - it.y;
                const d = Math.hypot(dx, dy);
                const step = ABILITY.itemPullSpeed * (dt / 1000);
                it.beingPulled = true;
                if (d <= ABILITY.swallowDist || step >= d) {
                    it.alive = false;
                    it.respawnMs = it.type === 'star' ? ABILITY.starRespawn : ABILITY.orbRespawn;
                    if (it.type === 'star') {
                        this.gainPower(POWERS[Math.floor(Math.random() * POWERS.length)], room);
                    } else {
                        this.mouth = { kind: 'orb' };
                        this.mouthMs = ABILITY.mouthMax;
                        room.broadcastEffect('swallow', { by: this.id, kind: 'orb' });
                        return;
                    }
                } else {
                    it.x += (dx / d) * step;
                    it.y += (dy / d) * step;
                }
            }

            // Rivals
            for (const p of Object.values(room.players)) {
                if (!isTargetable(p, this) || p.inhaleImmunity > 0) continue;
                const cx = p.x + p.width / 2, cy = p.y + p.height / 2;
                if (!inCone(cx, cy)) continue;

                if (Math.hypot(m.x - cx, m.y - cy) <= ABILITY.swallowDist) {
                    this.swallow(p, room);
                    return;
                }
                const oldX = p.x;
                p.x += Math.sign(m.x - cx) * ABILITY.playerPullSpeed * (dt / 1000);
                if (level.getCollidingTiles(p).length) p.x = oldX;
                p.beingInhaledMs = 120;
            }
        },

        swallow(victim, room) {
            victim.swallowedBy = this.id;
            victim.swallowTaps = 0;
            victim.pullDuration = 0;
            victim.vx = 0;
            victim.vy = 0;
            this.mouth = { kind: 'player', id: victim.id };
            this.mouthMs = ABILITY.mouthMax;
            room.broadcastEffect('swallow', { by: this.id, kind: 'player', victim: victim.id, byName: this.name, victimName: victim.name });
        },

        // Victim side: leave the mouth at (x, y) with the given velocity
        release(x, y, vx, vy) {
            this.swallowedBy = null;
            this.swallowTaps = 0;
            this.inhaleImmunity = ABILITY.swallowImmunity;
            this.x = x;
            this.y = y;
            this.vx = vx;
            this.vy = vy;
            this.isGrounded = false;
        },

        // Holder side: let go of a swallowed player (on death / finishing)
        dropMouth(room) {
            if (this.mouth && this.mouth.kind === 'player') {
                const victim = room.players[this.mouth.id];
                if (victim && victim.swallowedBy === this.id) victim.release(this.x, this.y, 0, -150);
            }
            this.mouth = null;
        },

        spit(room) {
            const m = this.mouthPoint();
            const mouth = this.mouth;
            this.mouth = null;
            if (!mouth) return;

            if (mouth.kind === 'orb') {
                room.spawnProjectile({ type: 'star', owner: this.id, x: m.x, y: m.y, vx: this.facing * ABILITY.spitSpeed, life: 1100 });
            } else {
                const victim = room.players[mouth.id];
                if (!victim || victim.swallowedBy !== this.id) return;
                victim.release(m.x - victim.width / 2, this.y, this.facing * ABILITY.spitBodySpeed, -90);
                victim.spitBodyMs = ABILITY.spitBodyMs;
                victim.spitBy = this.id;
                victim.spitHit = new Set();
                victim.markHit(this); // if they end up in a pit, the spitter gets the KO
            }
            room.broadcastEffect('spit', { by: this.id, kind: mouth.kind });
        },

        // Swallowed player mashing keys to get out
        struggle(room) {
            if (!this.swallowedBy) return;
            this.swallowTaps++;
            if (this.swallowTaps < ABILITY.escapeTaps) return;
            const holder = room.players[this.swallowedBy];
            if (holder) holder.mouth = null;
            const hx = holder ? holder.x : this.x;
            const hy = holder ? holder.y : this.y;
            this.release(hx, hy, -(holder ? holder.facing : 1) * 120, -280);
            room.broadcastEffect('escape', { id: this.id, name: this.name });
        },

        // Stay inside the holder's mouth; come out if the holder can no longer hold us
        updateSwallowed(dt, room) {
            const holder = room.players[this.swallowedBy];
            const valid = holder && !holder.isDead && !holder.isFinished &&
                holder.mouth && holder.mouth.id === this.id;
            if (!valid) {
                this.release(holder ? holder.x : this.x, holder ? holder.y : this.y, 0, -150);
                return;
            }
            this.x = holder.x + (holder.width - this.width) / 2;
            this.y = holder.y;
            this.vx = 0;
            this.vy = 0;
        },

        // V while holding a power: fire a fireball / freeze / spin
        usePower(room) {
            const type = this.power;
            const m = this.mouthPoint();
            this.powerCd = ABILITY.powerCooldown[type];
            this.pushDuration = 200;
            room.broadcastEffect('power_use', { id: this.id, power: type });

            if (type === 'fire') {
                room.spawnProjectile({ type: 'fire', owner: this.id, x: m.x, y: m.y, vx: this.facing * ABILITY.fireSpeed, life: 900 });
            } else if (type === 'ice') {
                const left = this.facing === 1 ? this.x + this.width : this.x - ABILITY.iceRange;
                for (const p of Object.values(room.players)) {
                    if (!isTargetable(p, this) || p.pullImmunity > 0 || p.pullDuration > 0) continue;
                    const cx = p.x + p.width / 2, cy = p.y + p.height / 2;
                    if (cx < left || cx > left + ABILITY.iceRange || Math.abs(cy - m.y) > 60) continue;
                    p.pullDuration = ABILITY.iceFreeze;
                    p.freezeKind = 'ice';
                    p.vx = 0;
                    p.markHit(this);
                    room.broadcastEffect('push_hit', { pusher: this.id, victim: p.id, dir: this.facing, kind: 'ice' });
                }
            } else if (type === 'spin') {
                this.spinMs = ABILITY.spinMs;
                this.spinHit = new Set();
            }
        },

        // While spinning, knock everyone nearby away (once per spin)
        applySpinHits(room) {
            if (this.spinMs <= 0) return;
            const cx = this.x + this.width / 2, cy = this.y + this.height / 2;
            for (const p of Object.values(room.players)) {
                if (!isTargetable(p, this) || this.spinHit.has(p.id)) continue;
                const px = p.x + p.width / 2, py = p.y + p.height / 2;
                if (Math.hypot(px - cx, py - cy) > ABILITY.spinRadius) continue;
                const dir = px >= cx ? 1 : -1;
                p.vx = dir * ABILITY.spinKnock;
                p.vy = -320;
                p.markHit(this);
                p.breakFree();
                this.spinHit.add(p.id);
                room.broadcastEffect('push_hit', { pusher: this.id, victim: p.id, dir, kind: 'spin' });
            }
        },

        // A freshly spat-out player bowls into others
        applySpitBodyHits(room) {
            if (this.spitBodyMs <= 0) return;
            const spitter = room.players[this.spitBy];
            for (const p of Object.values(room.players)) {
                if (!isTargetable(p, this) || p.id === this.spitBy || this.spitHit.has(p.id)) continue;
                if (!(this.x < p.x + p.width && this.x + this.width > p.x &&
                      this.y < p.y + p.height && this.y + this.height > p.y)) continue;
                const dir = this.vx >= 0 ? 1 : -1;
                p.vx = dir * ABILITY.spitKnock;
                p.vy = -260;
                if (spitter) p.markHit(spitter);
                p.breakFree();
                this.spitHit.add(p.id);
                room.broadcastEffect('push_hit', { pusher: this.spitBy, victim: p.id, dir, kind: 'spit' });
            }
        }
    });
}

module.exports = { install, POWERS, ABILITY };
