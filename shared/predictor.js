// Client-side prediction for the local player.
//
// Each fixed 1/60 s step the client makes a command {s: sequence, k: key bits}, applies it to
// its own copy of the player right away (so controls feel instant), and sends it to the server.
// The server applies the same commands with the same physics and reports the last one it
// processed (`ack`). On every server snapshot we start again from the server's state and
// replay the commands it hasn't seen yet; if both sides agree nothing visible happens, and if
// not (a push, a lag spike...) the difference is eased out over a fraction of a second.
//
// UMD: require() in Node (tests), window.Predictor in the browser.
(function (root, factory) {
    const Movement = (typeof module === 'object' && module.exports) ? require('./movement') : root.Movement;
    if (typeof module === 'object' && module.exports) module.exports = factory(Movement);
    else root.Predictor = factory(Movement);
})(typeof self !== 'undefined' ? self : this, function (Movement) {

    const { MOVE, FIELDS } = Movement;
    const MAX_PENDING = 120;       // 2 seconds of commands
    const SNAP_DISTANCE = 80;      // bigger corrections than this are applied instantly
    const SMOOTH_SECONDS = 0.1;

    class Predictor {
        constructor() {
            this.seq = 0;
            this.pending = [];       // commands the server hasn't acknowledged yet
            this.state = null;       // our predicted copy of the local player
            this.enabled = false;    // false while the server is in control of us
            this.active = false;     // true only during a round
            this.platforms = [];
            this.mods = {};
            this.acc = 0;            // leftover time toward the next step (ms)
            this.offX = 0;           // visual correction being eased out
            this.offY = 0;

            const self = this;
            this.world = {
                getCollidingTiles(p) {
                    return self.platforms.filter(pl => pl.active &&
                        p.x < pl.x + pl.width && p.x + p.width > pl.x &&
                        p.y < pl.y + pl.height && p.y + p.height > pl.y);
                }
            };
        }

        // Forget everything (new round, reconnect)
        reset() {
            this.pending = [];
            this.state = null;
            this.enabled = false;
            this.acc = 0;
            this.offX = 0;
            this.offY = 0;
        }

        // Advance real time by `elapsedMs`; returns the commands produced (0 or more steps).
        advance(elapsedMs, keys) {
            const cmds = [];
            if (!this.active) { this.acc = 0; return cmds; }

            this.acc += Math.min(elapsedMs, 100);
            const bits = Movement.encodeKeys(keys);

            while (this.acc >= MOVE.step) {
                this.acc -= MOVE.step;
                const cmd = { s: ++this.seq, k: bits };
                cmds.push(cmd);
                this.pending.push(cmd);
                if (this.pending.length > MAX_PENDING) this.pending.shift();
                if (this.enabled && this.state) this.apply(cmd);
            }

            // ease any leftover correction toward zero
            const decay = Math.exp(-(Math.min(elapsedMs, 100) / 1000) / SMOOTH_SECONDS);
            this.offX *= decay;
            this.offY *= decay;
            if (Math.abs(this.offX) < 0.05) this.offX = 0;
            if (Math.abs(this.offY) < 0.05) this.offY = 0;
            return cmds;
        }

        apply(cmd) {
            Movement.stepMovement(this.state, Movement.decodeKeys(cmd.k), MOVE.step, this.world, this.mods);
        }

        // Called with each server snapshot. `me` is our own entry in it.
        reconcile(me, platforms) {
            if (!me) return;
            this.platforms = platforms;

            const before = this.state && this.enabled ? { x: this.state.x, y: this.state.y } : null;

            const forced = me.isDead || me.isFinished || me.swallowed ||
                me.pullDuration > 0 || me.spitBodyMs > 0;

            while (this.pending.length && this.pending[0].s <= me.ack) this.pending.shift();

            const st = { width: me.width, height: me.height };
            for (const f of FIELDS) st[f] = me[f];
            this.state = st;
            this.mods = {
                spin: me.spinMs > 0,
                mouth: !!me.mouth,
                wings: me.power === 'wings',
                ballistic: false
            };

            if (forced) {
                // the server is moving us: just show what it says
                this.enabled = false;
                return;
            }

            this.enabled = true;
            for (const cmd of this.pending) this.apply(cmd);

            if (before) {
                const dx = before.x - this.state.x;
                const dy = before.y - this.state.y;
                if (Math.hypot(dx, dy) > SNAP_DISTANCE) { this.offX = 0; this.offY = 0; }
                else { this.offX += dx; this.offY += dy; }
            }
        }

        // What to draw for the local player (null = use the server's interpolated state)
        view() {
            if (!this.enabled || !this.state) return null;
            const s = this.state;
            return {
                x: s.x + this.offX, y: s.y + this.offY,
                vx: s.vx, vy: s.vy, isGrounded: s.isGrounded, facing: s.facing
            };
        }
    }

    return { Predictor, SNAP_DISTANCE };
});
