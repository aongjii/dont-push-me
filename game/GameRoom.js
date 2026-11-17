const Player = require('./Player');
const Level = require('./Level');
const GameLoop = require('./GameLoop');
const { sanitizeInput } = require('./validation');

class GameRoom {
    constructor(code, io) {
        this.code = code;
        this.io = io;
        this.players = {}; // id -> Player
        this.status = 'lobby'; // lobby, countdown, playing, round_end, match_end
        this.levelIndex = 1;
        this.round = 1;
        this.maxRounds = 3;
        this.countdownTimer = 0;
        this.countdownInterval = null;
        
        this.level = null;
        this.gameLoop = new GameLoop(this);

        this.colors = ['#FF4D4D', '#3399FF', '#FFCC00', '#2ECC71']; // Red, Blue, Yellow, Green
        this.finishOrder = []; // array of player ids who finished this round

        this.roundTimeLimit = 90 * 1000; // ms; unfinished players score 0 when it runs out
        this.roundTimeLeft = this.roundTimeLimit;

        // Kept so a reconnecting client can be shown the current end-of-round screen
        this.lastRoundEnd = null;
        this.lastMatchEnd = null;
    }

    addPlayer(id, name) {
        if (Object.keys(this.players).length >= 4) return null;
        
        // Pick an unused color
        const usedColors = Object.values(this.players).map(p => p.color);
        const availableColor = this.colors.find(c => !usedColors.includes(c)) || '#FFFFFF';

        const player = new Player(id, name, availableColor);
        this.players[id] = player;
        return player;
    }

    removePlayer(id) {
        delete this.players[id];
        
        // If room is empty, stop loop
        if (Object.keys(this.players).length === 0) {
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

    startGame() {
        if (this.status !== 'lobby') return;
        this.levelIndex = 1;
        this.round = 1;
        // Reset scores
        Object.values(this.players).forEach(p => p.score = 0);
        this.startRound();
    }

    startRound() {
        this.status = 'countdown';
        this.countdownTimer = 3;
        this.finishOrder = [];
        
        // Load Level data
        this.level = new Level(this.levelIndex);

        // Reset players to spawn coordinates
        Object.values(this.players).forEach(p => {
            p.reset(this.level.spawnX, this.level.spawnY);
        });

        this.roundTimeLeft = this.roundTimeLimit;
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
            finishZone: this.level.finishZone,
            hasRisingLava: this.level.hasRisingLava,
            lavaSpeed: this.level.lavaSpeed,
            lavaInitialY: this.level.lavaY,
            roundTimeLimit: this.roundTimeLimit
        };
    }

    handleInput(id, input) {
        const player = this.players[id];
        if (player && this.status === 'playing') {
            player.input = { ...player.input, ...sanitizeInput(input) };
        }
    }

    checkRoundEnd() {
        if (this.status !== 'playing') return;

        const playersArr = Object.values(this.players);
        const alivePlayers = playersArr.filter(p => !p.isDead && !p.isFinished);

        this.collectFinishers();

        // Round ends when everyone is dead/finished, or time is up
        if (alivePlayers.length === 0 || this.roundTimeLeft <= 0) {
            this.endRound();
        }
    }

    // Record players who reached the finish since the last check, in order
    collectFinishers() {
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

        // Build scoreboard
        const scoreboard = Object.values(this.players).map(p => ({
            id: p.id,
            name: p.name,
            color: p.color,
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
            this.levelIndex = (this.levelIndex % 3) + 1; // cycles 1 -> 2 -> 3
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

        this.lastMatchEnd = {
            scoreboard: scoreboard,
            winner: scoreboard[0]
        };
        this.io.to(this.code).emit('match_end', this.lastMatchEnd);
    }

    broadcastState() {
        if (this.status !== 'playing') return;

        const playersData = Object.values(this.players).map(p => ({
            id: p.id,
            name: p.name,
            color: p.color,
            x: p.x,
            y: p.y,
            vx: p.vx,
            vy: p.vy,
            width: p.width,
            height: p.height,
            isDead: p.isDead,
            isFinished: p.isFinished,
            facing: p.facing,
            pushCooldown: p.pushCooldown,
            pullCooldown: p.pullCooldown,
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

        this.io.to(this.code).emit('game_state', {
            players: playersData,
            hazards: hazardsData,
            platforms: this.level.platforms, // send current toggle status
            lavaY: this.level.hasRisingLava ? this.level.lavaY : null,
            timeLeft: Math.max(0, Math.ceil(this.roundTimeLeft / 1000))
        });
    }

    broadcastEffect(type, data) {
        this.io.to(this.code).emit('game_effect', { type, ...data });
    }
}

module.exports = GameRoom;
