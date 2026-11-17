// Gameplay tuning (ms unless noted)
const TUNING = {
    pushCooldown: 1200,
    pullCooldown: 2500,
    pullFreeze: 1000,        // how long a pull holds the victim
    pullBreakFreePerTap: 150, // each fresh key press shaves this off the freeze
    pullImmunity: 1000,      // after a pull ends, can't be pulled again (no chain-freezing)
    pushForce: 550,
    hitCreditWindow: 3000,   // a death this soon after a hit counts as a KO for the attacker
    catchUpGap: 400,         // px further from the finish than the leader to get catch-up help
    catchUpCooldownFactor: 0.75,
    catchUpPushFactor: 1.2
};

class Player {
    constructor(id, name, color) {
        this.id = id;
        this.name = name;
        this.color = color;
        this.x = 100;
        this.y = 100;
        this.vx = 0;
        this.vy = 0;
        this.width = 30;
        this.height = 40;
        this.isGrounded = false;
        this.facing = 1; // 1 = right, -1 = left

        // Connection state (managed by server.js)
        this.connected = true;
        this.socketId = null;
        this.token = null;
        this.graceTimer = null;

        // Game states
        this.score = 0;
        this.isDead = false;
        this.isFinished = false;
        
        // Sabotage effects
        this.pushCooldown = 0; // ms
        this.pullCooldown = 0; // ms
        this.pullDuration = 0; // ms (time frozen)
        this.pushDuration = 0; // ms (time showing push effect)
        this.lastPushedBy = null; // player name who pushed them last
        this.hitCredit = null; // { by: playerId, name, ms } - who gets the KO if we die soon
        this.pullImmunity = 0; // ms
        this.catchUp = false; // trailing far behind the leader: gets a small boost
        this.roundKos = 0;
        this.lastEmoteAt = 0;

        // Input
        this.input = {
            left: false,
            right: false,
            jump: false,
            push: false,
            pull: false,
            interact: false
        };
    }

    reset(spawnX, spawnY) {
        this.x = spawnX;
        this.y = spawnY;
        this.vx = 0;
        this.vy = 0;
        this.isGrounded = false;
        this.isDead = false;
        this.isFinished = false;
        this.pullDuration = 0;
        this.pushDuration = 0;
        this.pushCooldown = 0;
        this.pullCooldown = 0;
        this.lastPushedBy = null;
        this.hitCredit = null;
        this.pullImmunity = 0;
        this.catchUp = false;
        this.roundKos = 0;
    }

    get pushCooldownMax() {
        return TUNING.pushCooldown * (this.catchUp ? TUNING.catchUpCooldownFactor : 1);
    }

    get pullCooldownMax() {
        return TUNING.pullCooldown * (this.catchUp ? TUNING.catchUpCooldownFactor : 1);
    }

    // End a pull early (mashing keys, or being shoved). Grants brief immunity.
    breakFree(ms = Infinity) {
        if (this.pullDuration <= 0) return;
        this.pullDuration = Math.max(0, this.pullDuration - ms);
        if (this.pullDuration === 0) this.pullImmunity = TUNING.pullImmunity;
    }

    markHit(attacker) {
        this.lastPushedBy = attacker.name;
        this.hitCredit = { by: attacker.id, name: attacker.name, ms: TUNING.hitCreditWindow };
    }

    update(dt, level, gameRoom) {
        if (this.isDead || this.isFinished) return;

        // Reduce cooldowns & effects
        if (this.pushCooldown > 0) this.pushCooldown -= dt;
        if (this.pullCooldown > 0) this.pullCooldown -= dt;
        if (this.pullImmunity > 0) this.pullImmunity -= dt;

        // KO credit fades with time, and is void once the victim has recovered on solid ground
        if (this.hitCredit) {
            // While held by a pull the attacker keeps full credit
            if (this.pullDuration > 0) this.hitCredit.ms = TUNING.hitCreditWindow;
            this.hitCredit.ms -= dt;
            const settled = this.isGrounded && this.hitCredit.ms < TUNING.hitCreditWindow - 400;
            if (this.hitCredit.ms <= 0 || settled) this.hitCredit = null;
        }

        if (this.pullDuration > 0) {
            this.pullDuration -= dt;
            if (this.pullDuration <= 0) {
                this.pullDuration = 0;
                this.pullImmunity = TUNING.pullImmunity;
            }
            this.vx = 0; // frozen
            // Apply gravity even if frozen
            this.vy += 1200 * (dt / 1000);
            this.vy = Math.min(this.vy, 800);
            this.y += this.vy * (dt / 1000);
            this.resolveVerticalCollisions(level);
            return;
        }
        if (this.pushDuration > 0) this.pushDuration -= dt;

        const speed = 250;
        const accel = 1500;
        const drag = 10;
        const gravity = 1200;
        const jumpForce = -500;

        // Handle Horizontal Input & Physics
        let targetVx = 0;
        if (this.input.left) {
            targetVx = -speed;
            this.facing = -1;
        } else if (this.input.right) {
            targetVx = speed;
            this.facing = 1;
        }

        // Lerp horizontal velocity
        this.vx += (targetVx - this.vx) * drag * (dt / 1000);

        // Apply Gravity
        this.vy += gravity * (dt / 1000);
        this.vy = Math.min(this.vy, 800); // Terminal velocity

        // Jump
        if (this.input.jump && this.isGrounded) {
            this.vy = jumpForce;
            this.isGrounded = false;
        }

        // Apply velocities to positions and resolve collisions
        this.x += this.vx * (dt / 1000);
        this.resolveHorizontalCollisions(level);

        this.y += this.vy * (dt / 1000);
        this.resolveVerticalCollisions(level);

        // Sabotage Actions (Only check if not pushed/pulled in action)
        if (this.input.push && this.pushCooldown <= 0) {
            this.performPush(gameRoom);
        }
        if (this.input.pull && this.pullCooldown <= 0) {
            this.performPull(gameRoom);
        }
        if (this.input.interact) {
            this.performInteract(gameRoom);
            this.input.interact = false; // Reset to avoid toggle spam
        }

        // Check if out of level bounds (fell off map)
        if (this.y > level.height + 100) {
            this.die();
        }
    }

    die() {
        this.isDead = true;
        this.vx = 0;
        this.vy = 0;
    }

    resolveHorizontalCollisions(level) {
        const tiles = level.getCollidingTiles(this);
        for (let tile of tiles) {
            if (this.vx > 0) { // Moving right
                this.x = tile.x - this.width;
                this.vx = 0;
            } else if (this.vx < 0) { // Moving left
                this.x = tile.x + tile.width;
                this.vx = 0;
            }
        }
    }

    resolveVerticalCollisions(level) {
        this.isGrounded = false;
        const tiles = level.getCollidingTiles(this);
        for (let tile of tiles) {
            if (this.vy > 0) { // Falling down
                this.y = tile.y - this.height;
                this.vy = 0;
                this.isGrounded = true;
            } else if (this.vy < 0) { // Moving up
                this.y = tile.y + tile.height;
                this.vy = 0;
            }
        }
    }

    performPush(gameRoom) {
        this.pushCooldown = this.pushCooldownMax;
        this.pushDuration = 200; // Display push hands for 200ms

        // Box in front of player
        const range = 50;
        const pushBox = {
            x: this.facing === 1 ? this.x + this.width : this.x - range,
            y: this.y + 10,
            width: range,
            height: this.height - 20
        };

        // Detect other players in the push box
        for (let p of Object.values(gameRoom.players)) {
            if (p.id === this.id || p.isDead || p.isFinished) continue;

            if (p.x < pushBox.x + pushBox.width &&
                p.x + p.width > pushBox.x &&
                p.y < pushBox.y + pushBox.height &&
                p.y + p.height > pushBox.y) {
                
                // PUSH HIT! Apply high velocity impulse
                p.vx = this.facing * TUNING.pushForce * (this.catchUp ? TUNING.catchUpPushFactor : 1);
                p.vy = -200; // Pop up slightly
                p.markHit(this);
                p.breakFree(); // Release pull if they were pulled
                
                // Play particle/event trigger
                gameRoom.broadcastEffect('push_hit', { pusher: this.id, victim: p.id, dir: this.facing });
            }
        }
    }

    performPull(gameRoom) {
        this.pullCooldown = this.pullCooldownMax;

        // Check for closest player in front/around
        let target = null;
        let minDist = 120; // range limit

        for (let p of Object.values(gameRoom.players)) {
            if (p.id === this.id || p.isDead || p.isFinished) continue;
            if (p.pullImmunity > 0 || p.pullDuration > 0) continue; // can't be chain-pulled
            
            // Calculate distance
            const dx = p.x + p.width/2 - (this.x + this.width/2);
            const dy = p.y + p.height/2 - (this.y + this.height/2);
            const dist = Math.sqrt(dx*dx + dy*dy);

            // Prioritize target in direction player is facing
            const isCorrectDirection = (this.facing === 1 && dx > -20) || (this.facing === -1 && dx < 20);

            if (dist < minDist && isCorrectDirection) {
                minDist = dist;
                target = p;
            }
        }

        if (target) {
            target.pullDuration = TUNING.pullFreeze;
            target.vx = 0;
            target.markHit(this);
            gameRoom.broadcastEffect('pull_hit', { puller: this.id, victim: target.id });
        }
    }

    performInteract(gameRoom) {
        // Toggle switches near player (within 60px)
        const range = 60;
        const px = this.x + this.width/2;
        const py = this.y + this.height/2;

        let level = gameRoom.level;
        if (!level || !level.switches) return;

        level.switches.forEach((sw, idx) => {
            const dx = sw.x + sw.width/2 - px;
            const dy = sw.y + sw.height/2 - py;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < range) {
                // Toggle switch status
                sw.active = !sw.active;
                
                // Toggle target platforms linked to this switch index
                level.platforms.forEach(plat => {
                    if (plat.triggerIndex === idx) {
                        plat.active = !plat.active;
                    }
                });

                gameRoom.broadcastEffect('switch_toggle', { player: this.id, switchIndex: idx, active: sw.active });
            }
        });
    }
}

Player.TUNING = TUNING;
module.exports = Player;
