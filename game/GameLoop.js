class GameLoop {
    constructor(gameRoom) {
        this.room = gameRoom;
        this.intervalId = null;
        this.lastTime = Date.now();
        this.fps = 60;
        this.tickRate = 1000 / this.fps;
        
        // Broadcast throttling
        this.broadcastTimer = 0;
        this.broadcastRate = 1000 / 30; // 30Hz broadcast is clean and stable
    }

    start() {
        this.lastTime = Date.now();
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
        let dt = now - this.lastTime;
        this.lastTime = now;

        // Cap dt to prevent massive jumps on lag spikes
        if (dt > 100) dt = 100;

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

        // Check Round End conditions
        this.room.checkRoundEnd();

        // Throttled Network Broadcast
        this.broadcastTimer += dt;
        if (this.broadcastTimer >= this.broadcastRate) {
            this.broadcastTimer = 0;
            this.room.broadcastState();
        }
    }
}

module.exports = GameLoop;
