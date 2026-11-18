// If a command-driven player sends nothing for this long, the server moves them itself
// (so a dropped connection can't leave someone hovering in mid-air)
const CMD_STALL_MS = 250;

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

const { ABILITY } = require('./abilities');
const Movement = require('../shared/movement');

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

        // Jump feel (see shared/movement.js)
        this.coyote = 0;     // ms left to still jump after leaving a ledge
        this.jbuf = 0;       // ms left on a buffered jump press
        this.prevJump = false;
        this.flapCd = 0;

        // Client-driven movement (see GameRoom.handleCmds)
        this.usesCmds = false;   // true once this player has sent movement commands
        this.ackSeq = 0;         // last command number the server has processed
        this.lastSeq = 0;
        this.lastCmdAt = 0;
        this.moveBudget = 0;     // ms of movement the client is allowed to "spend"
        this.prevKeys = 0;
        this.inhaleEdge = false; // an inhale press happened since the last tick

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

        // Kirby-style abilities (see abilities.js)
        this.inhaling = false;
        this.prevInhale = false;
        this.powerCd = 0;          // cooldown of the power key
        this.mouth = null;         // { kind: 'orb' } | { kind: 'player', id }
        this.mouthMs = 0;
        this.swallowedBy = null;   // id of the player whose mouth we're in
        this.swallowTaps = 0;
        this.inhaleImmunity = 0;
        this.beingInhaledMs = 0;
        this.power = null;         // 'fire' | 'ice' | 'spin' | 'wings'
        this.powerMs = 0;
        this.spinMs = 0;
        this.spinHit = new Set();
        this.spitBodyMs = 0;
        this.spitBy = null;
        this.spitHit = new Set();
        this.freezeKind = 'pull';  // what froze us: 'pull' | 'ice'

        // Input
        this.input = {
            left: false,
            right: false,
            jump: false,
            push: false,
            pull: false,
            interact: false,
            inhale: false,
            power: false
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
        this.inhaling = false;
        this.prevInhale = false;
        this.prevJump = false;
        this.coyote = 0;
        this.jbuf = 0;
        this.powerCd = 0;
        this.ackSeq = 0;
        this.prevKeys = 0;
        this.inhaleEdge = false;
        this.moveBudget = 200;
        this.mouth = null;
        this.mouthMs = 0;
        this.swallowedBy = null;
        this.swallowTaps = 0;
        this.inhaleImmunity = 0;
        this.beingInhaledMs = 0;
        this.power = null;
        this.powerMs = 0;
        this.spinMs = 0;
        this.spinHit = new Set();
        this.spitBodyMs = 0;
        this.spitBy = null;
        this.spitHit = new Set();
        this.flapCd = 0;
        this.freezeKind = 'pull';
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

        // Inside someone's mouth: just ride along
        if (this.swallowedBy) {
            this.updateSwallowed(dt, gameRoom);
            return;
        }

        // Reduce cooldowns & effects
        if (this.pushCooldown > 0) this.pushCooldown -= dt;
        if (this.pullCooldown > 0) this.pullCooldown -= dt;
        if (this.pullImmunity > 0) this.pullImmunity -= dt;
        if (this.inhaleImmunity > 0) this.inhaleImmunity -= dt;
        if (this.beingInhaledMs > 0) this.beingInhaledMs -= dt;
        if (this.powerCd > 0) this.powerCd -= dt;
        if (this.spinMs > 0) this.spinMs -= dt;
        if (this.spitBodyMs > 0) {
            this.spitBodyMs -= dt;
            this.applySpitBodyHits(gameRoom);
        }
        if (this.power) {
            this.powerMs -= dt;
            if (this.powerMs <= 0) { this.power = null; this.powerMs = 0; this.spinMs = 0; }
        }
        if (this.mouth) {
            this.mouthMs -= dt;
            if (this.mouthMs <= 0) this.spit(gameRoom);
        }

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

        // Movement. A client that sends commands is moved by applyCmd() as they arrive;
        // everyone else (and any player the server has taken control of) is stepped here.
        if (!this.movesFromCmds()) {
            const res = Movement.stepMovement(this, this.input, dt, level, this.movementMods());
            if (res.flapped) gameRoom.broadcastEffect('flap', { id: this.id });
        }

        // Sabotage Actions (Only check if not pushed/pulled in action)
        if (this.input.push && this.pushCooldown <= 0) {
            this.performPush(gameRoom);
        }
        // Power key (V): fire / ice / spin. Wings are passive (jump in mid-air).
        if (this.input.power && this.power && this.power !== 'wings' && this.powerCd <= 0) {
            this.usePower(gameRoom);
        }
        this.applySpinHits(gameRoom);

        // Inhale: hold to suck things in; press again to spit what's in your mouth
        const inhalePressed = this.inhaleEdge || (this.input.inhale && !this.prevInhale);
        this.inhaleEdge = false;
        this.prevInhale = this.input.inhale;
        if (this.mouth) {
            this.inhaling = false;
            if (inhalePressed) this.spit(gameRoom);
        } else if (this.input.inhale) {
            this.inhaling = true;
            this.performInhale(dt, gameRoom);
        } else {
            this.inhaling = false;
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
        Movement.resolveHorizontal(this, level);
    }

    resolveVerticalCollisions(level) {
        Movement.resolveVertical(this, level);
    }

    // Status effects that change how movement behaves (shared with the client's prediction)
    movementMods() {
        return {
            spin: this.spinMs > 0,
            mouth: !!this.mouth,
            wings: this.power === 'wings',
            ballistic: this.spitBodyMs > 0
        };
    }

    // True while this player's walking/jumping is driven by their own commands
    movesFromCmds() {
        return this.usesCmds && this.spitBodyMs <= 0 && Date.now() - this.lastCmdAt < CMD_STALL_MS;
    }

    // Is the server (not the player) currently in charge of where they go?
    serverControlled() {
        return this.isDead || this.isFinished || !!this.swallowedBy || this.pullDuration > 0 || this.spitBodyMs > 0;
    }

    // Apply one client command: record the held keys, and move one fixed step if the player is free
    applyCmd(bits, level, room, canMove = true) {
        const K = Movement.KEY;
        const keys = Movement.decodeKeys(bits);

        if ((bits & K.inhale) && !(this.prevKeys & K.inhale)) this.inhaleEdge = true;
        if ((bits & K.interact) && !(this.prevKeys & K.interact)) this.input.interact = true;
        this.prevKeys = bits;
        this.input.left = keys.left;
        this.input.right = keys.right;
        this.input.jump = keys.jump;
        this.input.push = keys.push;
        this.input.pull = keys.pull;
        this.input.inhale = keys.inhale;
        this.input.power = keys.power;

        if (!canMove || this.serverControlled()) return;
        const res = Movement.stepMovement(this, keys, Movement.MOVE.step, level, this.movementMods());
        if (res.flapped) room.broadcastEffect('flap', { id: this.id });
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
            if (p.id === this.id || p.isDead || p.isFinished || p.swallowedBy) continue;

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
            if (p.swallowedBy || p.pullImmunity > 0 || p.pullDuration > 0) continue; // can't be chain-pulled
            
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
            target.freezeKind = 'pull';
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
require('./abilities').install(Player);
module.exports = Player;
