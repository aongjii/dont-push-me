const Player = require('./Player');
const Level = require('./Level');
const GameLoop = require('./GameLoop');
const { sanitizeInput, sanitizeEmote } = require('./validation');
const Movement = require('../shared/movement');
const { ABILITY } = require('./abilities');
const Skins = require('../shared/skins');
const { Bot } = require('./Bot');
const fs = require('fs');
const path = require('path');
const { sanitizeSettings, DEFAULTS } = require('./settings');

// Which level files exist: race levels (level1.json ...) and survival arenas (arena1.json ...)
const LEVEL_DIR = path.join(__dirname, 'levels');
const listLevels = (re, num) => fs.readdirSync(LEVEL_DIR).map(f => re.exec(f)).filter(Boolean)
    .map(m => (num ? parseInt(m[1], 10) : m[0].replace('.json', ''))).sort((a, b) => (num ? a - b : String(a).localeCompare(b)));
const RACE_LEVELS = listLevels(/^level(\d+)\.json$/, true);
const ARENA_LEVELS = listLevels(/^arena(\d+)\.json$/, false);

function shuffled(list, rnd = Math.random) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const KO_POINTS = 3; // bonus for sending a rival to their doom
const MAX_CMDS_PER_MESSAGE = 30;
// Up to 5 players side by side at the start (every level's start area fits that); more share spots
const SPAWN_COLUMNS = 5;
const SPAWN_SPACING = 32;
const MOVE_BUDGET_CAP = 500;     // ms of banked movement (covers a burst after a lag spike)
const MOVE_BUDGET_RATE = 1.05;   // a little slack for clock drift between client and server
const STUN_MS = 700;             // how long a stomped player is squashed
const STOMP_GUARD_MS = 1500;     // ...and then can't be stomped-stunned again for this long
const RESPAWN_MS = 3000;         // how long you wait after dying
const INVULN_MS = 2000;          // spikes/lava can't hurt right after you come back
const LAVA_SAFETY_MARGIN = 140;  // don't respawn closer than this to rising lava (px)

class GameRoom {
    constructor(code, io, initialSettings) {
        this.code = code;
        this.io = io;
        this.players = {}; // id -> Player
        this.status = 'lobby'; // lobby, countdown, playing, round_end, match_end
        this.levelIndex = 1;
        this.round = 1;
        this.bots = {}; // id -> Bot (computer players)
        this.botSeq = 0;
        this.roundStartedAt = 0;
        this.settings = sanitizeSettings(initialSettings, DEFAULTS);
        this.maxRounds = this.settings.rounds;
        this.levelOrder = [1];
        this.countdownTimer = 0;
        this.countdownInterval = null;
        
        this.level = null;
        // Walking/jumping world: the level's platforms plus the other players as solid bodies
        this.moveWorld = new Movement.PlayerWorld({
            getCollidingTiles: (p) => this.level.getCollidingTiles(p),
            zoneAt: (p) => this.level.zoneAt(p)
        }, () => Object.values(this.players));
        this.gameLoop = new GameLoop(this);

        this.finishOrder = []; // array of player ids who finished this round

        this.roundTimeLimit = 90 * 1000; // ms (each level can override); unfinished players score 0 when it runs out
        this.projectiles = []; // fireballs and spat-out stars
        this.nextProjectileId = 1;
        this.roundTimeLeft = this.roundTimeLimit;

        // Kept so a reconnecting client can be shown the current end-of-round screen
        this.lastRoundEnd = null;
        this.lastMatchEnd = null;
    }

    // `rawSkin` is whatever the client asked for; it is validated here. Body colours are unique
    // within a room (so you can tell players apart), so a taken colour is swapped for a free one.
    addPlayer(id, name, rawSkin) {
        if (Object.keys(this.players).length >= this.settings.maxPlayers) return null;

        const skin = Skins.sanitizeSkin(rawSkin);
        const used = Object.values(this.players).map(p => p.color);
        if (used.some(c => c.toUpperCase() === skin.color.toUpperCase())) skin.color = Skins.freeColor(used);

        const player = new Player(id, name, skin.color);
        player.skin = { face: skin.face, hat: skin.hat, acc: skin.acc, acc2: skin.acc2, pat: skin.pat };
        this.players[id] = player;
        return player;
    }

    // Change look while waiting in the lobby. Returns the skin actually applied.
    setSkin(id, rawSkin) {
        const player = this.players[id];
        if (!player || this.status !== 'lobby') return null;

        const skin = Skins.sanitizeSkin(rawSkin);
        const others = Object.values(this.players).filter(p => p.id !== id).map(p => p.color.toUpperCase());
        if (others.includes(skin.color.toUpperCase())) skin.color = player.color; // taken: keep ours

        player.color = skin.color;
        player.skin = { face: skin.face, hat: skin.hat, acc: skin.acc, acc2: skin.acc2, pat: skin.pat };
        return { color: player.color, ...player.skin };
    }

    // ---- computer players
    addBot(opts = {}) {
        if (Object.keys(this.players).length >= this.settings.maxPlayers || this.status !== 'lobby') return null;
        this.botSeq++;
        const id = `bot${this.botSeq}`;
        const player = this.addPlayer(id, opts.name || `บอท ${this.botSeq}`, Skins.randomSkin());
        if (!player) return null;
        player.isBot = true;
        this.bots[id] = new Bot(player, { dummy: !!opts.dummy });
        return player;
    }

    removeLastBot() {
        if (this.status !== 'lobby') return false;
        const id = Object.keys(this.bots).pop();
        if (!id) return false;
        delete this.bots[id];
        delete this.players[id];
        return true;
    }

    humanCount() {
        return Object.values(this.players).filter(p => !p.isBot).length;
    }

    updateBots(dt) {
        for (const id of Object.keys(this.bots)) {
            if (this.players[id]) this.bots[id].think(this, dt);
        }
    }

    roundElapsedMs() {
        return this.roundTimeLimit - this.roundTimeLeft;
    }

    removePlayer(id) {
        delete this.players[id];
        delete this.bots[id];
        
        // If no human is left, stop the loop and close the room
        if (this.humanCount() === 0) {
            this.destroy();
        } else {
            // Check round end in case the only remaining alive player left
            if (this.status === 'playing') {
                this.checkRoundEnd();
            }
        }
    }

    destroy() {
        this.gameLoop.stop();
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
        }
    }

    // Host changes in the waiting room. Returns the settings now in force, or null if not allowed.
    setSettings(raw) {
        if (this.status !== 'lobby') return null;
        const next = sanitizeSettings(raw, this.settings);
        // can't shrink the room below the number of people already in it
        if (next.maxPlayers < Object.keys(this.players).length) next.maxPlayers = this.settings.maxPlayers;
        this.settings = next;
        return this.settings;
    }

    // What the lobby shows: the settings plus how many levels the current mode can pick from
    publicSettings() {
        const survival = this.settings.mode === 'survival' && ARENA_LEVELS.length;
        return { ...this.settings, pool: (survival ? ARENA_LEVELS : RACE_LEVELS).length };
    }

    // The levels for this match, one per round (shuffled without repeats when asked to)
    buildLevelOrder() {
        if (this.tutorial) return ['tutorial'];
        const pool = this.settings.mode === 'survival' && ARENA_LEVELS.length ? ARENA_LEVELS : RACE_LEVELS;
        const order = [];
        while (order.length < this.settings.rounds) {
            order.push(...(this.settings.shuffle ? shuffled(pool) : pool));
        }
        return order.slice(0, this.settings.rounds);
    }

    // Team of each player if teams are on: alternate red / blue in join order (humans first)
    teamPreview() {
        const out = {};
        if (!this.settings.teams) return out;
        const all = Object.values(this.players);
        [...all.filter(p => !p.isBot), ...all.filter(p => p.isBot)].forEach((p, i) => { out[p.id] = i % 2 === 0 ? 'red' : 'blue'; });
        return out;
    }

    assignTeams() {
        const t = this.teamPreview();
        Object.values(this.players).forEach(p => { p.team = t[p.id] || null; });
    }

    startGame() {
        if (this.status !== 'lobby') return;
        this.maxRounds = this.settings.rounds;
        this.levelOrder = this.buildLevelOrder();
        this.levelIndex = this.levelOrder[0];
        this.round = 1;
        // Reset scores
        Object.values(this.players).forEach(p => p.score = 0);
        this.assignTeams();
        this.startRound();
    }

    startRound() {
        this.status = 'countdown';
        this.countdownTimer = 3;
        this.finishOrder = [];
        this.elimOrder = [];
        
        // Load Level data
        this.level = new Level(this.levelIndex);

        // Reset players to spawn coordinates
        // Spread the spawn points so players aren't stacked inside each other
        Object.values(this.players).forEach((p, i) => {
            p.reset(this.level.spawnX + (i % SPAWN_COLUMNS) * SPAWN_SPACING, this.level.spawnY, this.settings.lives);
        });
        if (!this.settings.items) this.level.items = [];
        // Bots never run out of hearts: they just keep trying, like a beginner who won't give up
        Object.values(this.players).forEach(p => { if (p.isBot) p.respawnsLeft = 999; });

        this.roundTimeLimit = this.level.timeLimit * 1000;
        this.roundTimeLeft = this.roundTimeLimit;
        this.projectiles = [];
        this.lastRoundEnd = null;

        // Notify client to load screen
        this.io.to(this.code).emit('round_load', this.getRoundLoadPayload());

        // Start countdown interval
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        this.countdownInterval = setInterval(() => {
            this.countdownTimer--;
            this.io.to(this.code).emit('countdown', { timer: this.countdownTimer });

            if (this.countdownTimer <= 0) {
                clearInterval(this.countdownInterval);
                this.countdownInterval = null;
                this.status = 'playing';
                this.gameLoop.start();
                this.io.to(this.code).emit('round_start');
            }
        }, 1000);
    }

    getRoundLoadPayload() {
        return {
            levelIndex: this.levelIndex,
            round: this.round,
            maxRounds: this.maxRounds,
            levelWidth: this.level.width,
            levelHeight: this.level.height,
            platforms: this.level.platforms,
            switches: this.level.switches,
            hazards: this.level.hazards,
            shooters: this.level.shooters,
            zones: this.level.zones,
            finishZone: this.level.finishZone,
            hasRisingLava: this.level.hasRisingLava,
            lavaSpeed: this.level.lavaSpeed,
            lavaInitialY: this.level.lavaY,
            roundTimeLimit: this.roundTimeLimit,
            theme: this.level.theme,
            checkpoints: this.level.checkpoints,
            lives: this.settings.lives,
            hints: this.level.hints || [],
            tutorial: !!this.tutorial,
            mode: this.level.mode
        };
    }

    handleInput(id, input) {
        const player = this.players[id];
        if (player && !player.usesCmds && this.status === 'playing') {
            const clean = sanitizeInput(input);

            // Mashing movement keys while pulled (or swallowed) shakes the victim loose
            if (player.pullDuration > 0 || player.swallowedBy) {
                ['left', 'right', 'jump'].forEach(key => {
                    if (clean[key] && !player.input[key]) {
                        if (player.swallowedBy) player.struggle(this);
                        else player.breakFree(Player.TUNING.pullBreakFreePerTap);
                    }
                });
            }

            player.input = { ...player.input, ...clean };
        }
    }

    // Movement commands from a client: [{ s: sequence number, k: held-key bits }, ...].
    // Each command moves that player exactly one fixed step, which is what lets the client
    // predict its own movement and the server agree with it.
    handleCmds(id, cmds) {
        const player = this.players[id];
        if (!player || this.status !== 'playing' || !Array.isArray(cmds)) return;

        player.usesCmds = true;
        const K = Movement.KEY;

        for (const c of cmds.slice(0, MAX_CMDS_PER_MESSAGE)) {
            if (!c || !Number.isInteger(c.s) || !Number.isInteger(c.k) || c.k < 0 || c.k > 255) continue;
            if (c.s <= player.lastSeq) continue; // old or duplicate
            player.lastSeq = c.s;
            player.ackSeq = c.s;
            player.lastCmdAt = Date.now();

            // Mashing movement keys while pulled / swallowed shakes the victim loose
            if (player.pullDuration > 0 || player.swallowedBy) {
                [K.left, K.right, K.jump].forEach(bit => {
                    if ((c.k & bit) && !(player.prevKeys & bit)) {
                        if (player.swallowedBy) player.struggle(this);
                        else player.breakFree(Player.TUNING.pullBreakFreePerTap);
                    }
                });
            }

            // Movement is limited to real time (plus a little slack) so a client
            // can't speed itself up by sending commands faster than it should.
            const canMove = player.moveBudget >= Movement.MOVE.step;
            if (canMove) player.moveBudget -= Movement.MOVE.step;
            player.applyCmd(c.k, this.level, this, canMove);
        }
    }

    // Back to the waiting room for another match with the same people
    resetToLobby() {
        if (this.status !== 'match_end') return false;
        this.status = 'lobby';
        this.gameLoop.stop();
        this.projectiles = [];
        this.finishOrder = [];
        this.lastRoundEnd = null;
        this.lastMatchEnd = null;
        this.levelOrder = [1];
        this.levelIndex = 1;
        this.round = 1;
        Object.values(this.players).forEach(p => { p.score = 0; });
        return true;
    }

    handleEmote(id, rawEmote) {
        const player = this.players[id];
        const emote = sanitizeEmote(rawEmote);
        if (!player || emote === null || this.status !== 'playing') return;

        const now = Date.now();
        if (now - player.lastEmoteAt < 1000) return;
        player.lastEmoteAt = now;
        this.broadcastEffect('emote', { player: id, emote });
    }

    // Players far behind the leader get shorter cooldowns and a stronger shove
    updateCatchUp() {
        const f = this.level.finishZone;
        const fx = f.x + f.width / 2;
        const fy = f.y + f.height / 2;
        const racers = Object.values(this.players).filter(p => !p.isDead && !p.isFinished);
        if (racers.length < 2) {
            racers.forEach(p => { p.catchUp = false; });
            return;
        }
        const dist = p => Math.hypot(p.x + p.width / 2 - fx, p.y + p.height / 2 - fy);
        const lead = Math.min(...racers.map(dist));
        racers.forEach(p => { p.catchUp = dist(p) - lead > Player.TUNING.catchUpGap; });
    }

    spawnProjectile(proj) {
        this.projectiles.push({ id: this.nextProjectileId++, ...proj });
    }

    // Move fireballs / spat stars; they knock back the first rival they touch
    updateProjectiles(dt) {
        const size = 14;
        const level = this.level;
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const pr = this.projectiles[i];
            pr.x += pr.vx * (dt / 1000);
            pr.life -= dt;
            let remove = pr.life <= 0 || pr.x < -50 || pr.x > level.width + 50;

            const box = { x: pr.x - size / 2, y: pr.y - size / 2, width: size, height: size };

            if (!remove && level.platforms.some(pl => pl.active &&
                box.x < pl.x + pl.width && box.x + size > pl.x &&
                box.y < pl.y + pl.height && box.y + size > pl.y)) {
                remove = true;
            }

            if (!remove) {
                const owner = this.players[pr.owner];
                for (const p of Object.values(this.players)) {
                    if (p.id === pr.owner || p.isDead || p.isFinished || p.swallowedBy) continue;
                    if (owner && owner.team && owner.team === p.team) continue; // no friendly fire
                    if (!(box.x < p.x + p.width && box.x + size > p.x &&
                          box.y < p.y + p.height && box.y + size > p.y)) continue;
                    const dir = pr.vx >= 0 ? 1 : -1;
                    p.vx = dir * (pr.type === 'fire' ? 450 : 650 * (pr.power || 1));
                    p.vy = -250;
                    if (owner) p.markHit(owner);
                    p.breakFree();
                    this.broadcastEffect('push_hit', { pusher: pr.owner, victim: p.id, dir, kind: pr.type });
                    remove = true;
                    break;
                }
            }

            if (remove) this.projectiles.splice(i, 1);
        }
    }

    // Called once when a player dies. Credits the attacker if the victim was recently hit.
    // Where this player would come back to: their furthest checkpoint, or an earlier one / the
    // start if lava has risen past it. null = nowhere safe, so they're out for this round.
    pickRespawn(player) {
        const level = this.level;
        if (level.mode === 'survival') {
            // back onto whichever platform will stand the longest
            let best = null, bestLife = 3000;
            for (const pl of level.platforms) {
                if (!pl.active || pl.height < 10) continue;
                const life = pl.crumbleAt === null ? 1e9 : pl.crumbleAt - level.elapsed;
                if (life > bestLife) { best = pl; bestLife = life; }
            }
            return best ? { x: best.x + best.width / 2 - 15, y: best.y - 40 } : null;
        }
        const safe = (pt) => !level.hasRisingLava || pt.y + 40 < level.lavaY - LAVA_SAFETY_MARGIN;
        const at = (cp) => ({ x: cp.x - 15, y: cp.y - 40 });

        for (let i = Math.min(player.cpIndex, level.checkpoints.length - 1); i >= 0; i--) {
            const pt = at(level.checkpoints[i]);
            if (safe(pt)) return pt;
        }
        const idx = Object.keys(this.players).indexOf(player.id);
        const start = { x: level.spawnX + (Math.max(0, idx) % SPAWN_COLUMNS) * SPAWN_SPACING, y: level.spawnY };
        return safe(start) ? start : null;
    }

    // Called when a player dies: schedule the comeback if they have a life and somewhere safe to go
    scheduleRespawn(player) {
        if (player.respawnsLeft > 0 && this.pickRespawn(player)) {
            player.respawnsLeft--;
            player.respawnMs = RESPAWN_MS;
        } else {
            player.respawnMs = 0; // out of the round
        }
    }

    respawn(player) {
        const pt = this.pickRespawn(player);
        if (!pt) {
            player.respawnMs = 0; // lava got there first: out for good
            return;
        }
        player.x = pt.x;
        player.y = pt.y;
        player.vx = 0;
        player.vy = 0;
        player.isDead = false;
        player.isGrounded = false;
        player.invulnMs = INVULN_MS;
        player.power = null;
        player.powerMs = 0;
        player.spinMs = 0;
        player.spitBodyMs = 0;
        player.pullDuration = 0;
        player.swallowedBy = null;
        player.mouth = null;
        player.hitCredit = null;
        player.recover = 0;
        player.coyote = 0;
        player.jbuf = 0;
        this.broadcastEffect('respawn', { id: player.id, name: player.name });
    }

    // Reaching a checkpoint flag saves your respawn spot (the furthest one counts)
    updateCheckpoints(player) {
        const cps = this.level.checkpoints;
        for (let i = cps.length - 1; i > player.cpIndex; i--) {
            const cp = cps[i];
            const feet = player.y + player.height;
            if (Math.abs(player.x + player.width / 2 - cp.x) < 50 && feet <= cp.y + 8 && feet >= cp.y - 120) {
                player.cpIndex = i;
                this.broadcastEffect('checkpoint', { id: player.id, name: player.name, index: i });
                break;
            }
        }
    }

    // Somebody landed hard on somebody's head (called from the movement step)
    onStomp(stomper, victimId) {
        const victim = this.players[victimId];
        if (!victim || victim.isDead) return;
        if (victim.stompGuardMs > 0) return; // bouncing off them is fine, but no stun-locking
        if (victim.team && victim.team === stomper.team) return; // a teammate's head is a springboard, not a target
        victim.stunMs = STUN_MS;
        victim.stompGuardMs = STUN_MS + STOMP_GUARD_MS;
        victim.markHit(stomper); // if they end up in a pit, the stomper gets the KO
        this.broadcastEffect('stomp', { by: stomper.id, victim: victim.id, byName: stomper.name, victimName: victim.name });
    }

    handleDeath(victim) {
        victim.dropMouth(this); // anyone we were holding comes out
        const credit = victim.hitCredit;
        victim.hitCredit = null;

        const attacker = credit && credit.ms > 0 && credit.by !== victim.id ? this.players[credit.by] : null;
        if (attacker) attacker.roundKos++;

        this.scheduleRespawn(victim);

        this.broadcastEffect('player_died', {
            id: victim.id,
            name: victim.name,
            killerId: attacker ? attacker.id : null,
            killerName: attacker ? attacker.name : null,
            willRespawn: victim.respawnMs > 0
        });
    }

    // Survival arenas: last one standing wins; points follow the order people dropped out
    checkSurvivalEnd() {
        const players = Object.values(this.players);
        const out = (p) => p.isDead && p.respawnMs <= 0;
        this.elimOrder = this.elimOrder || [];
        players.forEach(p => { if (out(p) && !this.elimOrder.includes(p.id)) this.elimOrder.push(p.id); });
        const alive = players.filter(p => !out(p));
        const humansAlive = alive.some(p => !p.isBot);
        if (alive.length > 1 && humansAlive && this.roundTimeLeft > 0) return;
        if (players.length < 2 && this.roundTimeLeft > 0) return;
        // survivors first (most lives left on top), then the rest in reverse order of elimination
        alive.sort((a, b) => b.respawnsLeft - a.respawnsLeft);
        alive.forEach(p => { p.isFinished = true; });
        this.finishOrder = [...alive.map(p => p.id), ...[...this.elimOrder].reverse()];
        this.endRound();
    }

    checkRoundEnd() {
        if (this.status !== 'playing') return;
        if (this.level && this.level.mode === 'survival') { this.checkSurvivalEnd(); return; }

        // Still in the round: not finished, and not out of lives (a player waiting to respawn counts)
        const playersArr = Object.values(this.players);
        let alivePlayers = playersArr.filter(p => !p.isFinished && !(p.isDead && p.respawnMs <= 0));
        // Computer players never keep a round going: once every human is done, the round is over
        if (playersArr.some(p => !p.isBot)) alivePlayers = alivePlayers.filter(p => !p.isBot);

        this.collectFinishers();

        // Round ends when everyone is dead/finished, or time is up
        if (alivePlayers.length === 0 || this.roundTimeLeft <= 0) {
            this.endRound();
        }
    }

    // Record players who reached the finish since the last check, in order
    collectFinishers() {
        if (this.level && this.level.mode === 'survival') return;
        Object.values(this.players).forEach(p => {
            if (p.isFinished && !this.finishOrder.includes(p.id)) {
                this.finishOrder.push(p.id);
            }
        });
    }

    endRound() {
        if (this.status !== 'playing') return;
        this.collectFinishers();
        this.status = 'round_end';
        this.gameLoop.stop();

        // Calculate points for this round
        // 1st: 10, 2nd: 8, 3rd: 6, 4th: 4. Dead: 0
        const pointsMapping = [10, 8, 6, 4];
        const roundPoints = {};

        this.finishOrder.forEach((id, index) => {
            const points = pointsMapping[index] || 2;
            if (this.players[id]) {
                this.players[id].score += points;
                roundPoints[id] = points;
            }
        });

        // KO bonuses (kept even if the attacker later died or ran out of time)
        Object.values(this.players).forEach(p => {
            if (p.roundKos > 0) {
                const bonus = p.roundKos * KO_POINTS;
                p.score += bonus;
                roundPoints[p.id] = (roundPoints[p.id] || 0) + bonus;
            }
        });

        // Build scoreboard
        const scoreboard = Object.values(this.players).map(p => ({
            id: p.id,
            name: p.name,
            color: p.color,
            kos: p.roundKos,
            roundPoints: roundPoints[p.id] || 0,
            totalScore: p.score,
            status: p.isFinished ? 'FINISHED' : 'DEAD'
        })).sort((a, b) => b.totalScore - a.totalScore);

        this.lastRoundEnd = {
            round: this.round,
            levelIndex: this.levelIndex,
            scoreboard: scoreboard,
            finishOrder: this.finishOrder.map(id => this.players[id]?.name || '')
        };
        this.io.to(this.code).emit('round_end', this.lastRoundEnd);
    }

    nextRound() {
        if (this.status !== 'round_end') return;

        if (this.round >= this.maxRounds) {
            this.endMatch();
        } else {
            this.round++;
            this.levelIndex = this.levelOrder[this.round - 1];
            this.startRound();
        }
    }

    endMatch() {
        this.status = 'match_end';
        
        const scoreboard = Object.values(this.players).map(p => ({
            id: p.id,
            name: p.name,
            color: p.color,
            totalScore: p.score
        })).sort((a, b) => b.totalScore - a.totalScore);

        // Team play: the team totals decide who wins
        let teams = null, winnerTeam = null;
        if (this.settings.teams) {
            teams = { red: 0, blue: 0 };
            Object.values(this.players).forEach(p => { if (p.team) teams[p.team] += p.score; });
            winnerTeam = teams.red === teams.blue ? null : (teams.red > teams.blue ? 'red' : 'blue');
        }
        this.lastMatchEnd = {
            scoreboard: scoreboard,
            winner: scoreboard[0],
            teams,
            winnerTeam
        };
        this.io.to(this.code).emit('match_end', this.lastMatchEnd);
    }

    broadcastState() {
        if (this.status !== 'playing') return;

        const playersData = Object.values(this.players).map(p => ({
            id: p.id,
            name: p.name,
            color: p.color,
            face: p.skin.face,
            hat: p.skin.hat,
            acc: p.skin.acc,
            acc2: p.skin.acc2,
            pat: p.skin.pat,
            x: p.x,
            y: p.y,
            vx: p.vx,
            vy: p.vy,
            width: p.width,
            height: p.height,
            isDead: p.isDead,
            isFinished: p.isFinished,
            facing: p.facing,
            isGrounded: p.isGrounded,
            // for the owner's client-side prediction (see shared/movement.js)
            ack: p.ackSeq,
            coyote: p.coyote,
            jbuf: p.jbuf,
            prevJump: p.prevJump,
            flapCd: p.flapCd,
            flaps: p.flaps,
            recover: p.recover,
            lives: p.isDead && p.respawnMs <= 0 ? 0 : p.respawnsLeft + 1,
            respawnMs: Math.max(0, Math.round(p.respawnMs)),
            team: p.team || null,
            invulnMs: Math.max(0, Math.round(p.invulnMs)),
            stunMs: Math.max(0, Math.round(p.stunMs)),
            cp: p.cpIndex,
            swallowTaps: p.swallowTaps,
            tapsNeeded: ABILITY.escapeTaps,
            powerCd: Math.max(0, Math.round(p.powerCd)),
            inhaling: p.inhaling,
            mouth: p.mouth ? p.mouth.kind : null,
            charge: p.mouthCharge(),
            mouthId: p.mouth && p.mouth.kind === 'player' ? p.mouth.id : null,
            swallowed: !!p.swallowedBy,
            power: p.power,
            powerMs: Math.max(0, Math.round(p.powerMs)),
            spinMs: Math.max(0, Math.round(p.spinMs)),
            spitBodyMs: Math.max(0, Math.round(p.spitBodyMs)),
            freezeKind: p.freezeKind,
            catchUp: p.catchUp,
            pushCooldown: p.pushCooldown,
            pullCooldown: p.pullCooldown,
            pushCooldownMax: p.pushCooldownMax,
            pullCooldownMax: p.pullCooldownMax,
            pushDuration: p.pushDuration,
            pullDuration: p.pullDuration,
            lastPushedBy: p.lastPushedBy
        }));

        // Dynamic hazard sync
        const hazardsData = (this.level?.hazards || []).map(haz => ({
            x: haz.x,
            y: haz.y,
            width: haz.width,
            height: haz.height,
            type: haz.type
        }));
        const shotsData = (this.level?.shots || []).map(sh => ({ id: sh.id, kind: sh.kind, x: Math.round(sh.x), y: Math.round(sh.y), width: sh.width, height: sh.height, vx: sh.vx, vy: sh.vy }));

        this.io.to(this.code).emit('game_state', {
            players: playersData,
            hazards: hazardsData,
            shots: shotsData,
            shooterTimers: (this.level.shooters || []).map(sh => Math.max(0, Math.round(sh.timer))),
            platforms: this.level.platforms, // send current toggle status
            items: this.level.items.map(it => ({ id: it.id, type: it.type, x: Math.round(it.x), y: Math.round(it.y), alive: it.alive })),
            projectiles: this.projectiles.map(pr => ({ id: pr.id, type: pr.type, x: Math.round(pr.x), y: Math.round(pr.y), vx: pr.vx })),
            lavaY: this.level.hasRisingLava ? this.level.lavaY : null,
            timeLeft: Math.max(0, Math.ceil(this.roundTimeLeft / 1000))
        });
    }

    broadcastEffect(type, data) {
        this.io.to(this.code).emit('game_effect', { type, ...data });
    }
}

module.exports = GameRoom;
