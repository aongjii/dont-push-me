class GameLoop {
    constructor(gameRoom) {
        this.room = gameRoom;
        this.intervalId = null;
        this.lastTime = Date.now();
        this.fps = 60;
        this.tickRate = 1000 / this.fps;
        this.step = 1000 / this.fps; // fixed physics step (ms)
        this.accumulator = 0;
        this.maxStepsPerTick = 5;
        
        // Broadcast every N physics steps (2 steps of 60Hz = 30Hz). Counting steps rather
        // than wall-clock time keeps the rate even when timers fire a ms early/late.
        this.stepsPerBroadcast = 2;
        this.stepsSinceBroadcast = 0;
    }

    start() {
        this.lastTime = Date.now();
        this.accumulator = 0;
        this.stepsSinceBroadcast = 0;
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = setInterval(() => this.tick(), this.tickRate);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    tick() {
        const now = Date.now();
        let elapsed = now - this.lastTime;
        this.lastTime = now;

        // Cap to avoid a spiral of death after a long stall
        if (elapsed > 100) elapsed = 100;

        // Fixed timestep: physics always advances in equal slices so jump height,
        // collisions and hazard motion don't depend on timer jitter.
        this.accumulator += elapsed;
        let steps = 0;
        while (this.accumulator >= this.step && steps < this.maxStepsPerTick) {
            this.update(this.step);
            this.accumulator -= this.step;
            steps++;
            this.stepsSinceBroadcast++;
            if (this.room.status !== 'playing') return;
        }
        if (steps === this.maxStepsPerTick) this.accumulator = 0;

        // Throttled Network Broadcast
        if (this.stepsSinceBroadcast >= this.stepsPerBroadcast) {
            this.stepsSinceBroadcast = 0;
            this.room.broadcastState();
        }
    }

    update(dt) {
        // Update Level
        if (this.room.level) {
            this.room.level.update(dt);
        }

        // Update Players
        const players = Object.values(this.room.players);
        players.forEach(player => {
            player.update(dt, this.room.level, this.room);

            // Hazard collision checks
            if (this.room.level.checkHazards(player)) {
                player.die();
                this.room.broadcastEffect('player_died', { id: player.id, name: player.name });
            }

            // Finish check
            if (this.room.level.checkFinish(player)) {
                player.isFinished = true;
                player.vx = 0;
                player.vy = 0;
                this.room.broadcastEffect('player_finished', { id: player.id, name: player.name });
            }
        });

        // Round time limit
        this.room.roundTimeLeft -= dt;

        // Check Round End conditions
        this.room.checkRoundEnd();
    }
}

module.exports = GameLoop;
