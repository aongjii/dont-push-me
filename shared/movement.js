// Walking / jumping physics, shared by the server (authoritative) and the browser
// (client-side prediction). Both must run EXACTLY this code so they agree.
// UMD: require() in Node, window.Movement in the browser.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Movement = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const MOVE = {
        step: 1000 / 60,       // fixed step (ms); every command advances exactly one step
        speed: 250,
        drag: 10,              // how quickly horizontal speed approaches the target
        gravity: 1200,
        jumpForce: -500,
        terminal: 800,
        coyoteMs: 100,         // can still jump this long after walking off a ledge
        jumpBufferMs: 120,     // a jump pressed this long before landing still counts
        flapForce: -380,       // wings power
        flapCooldown: 280,
        flapsPerPower: 8,      // wings are limited: this many flaps, then only gliding
        glideFall: 110,
        spitGravity: 0.2,       // a spat-out player floats down slowly for a moment (time to react)
        recoverForce: -480,    // the one "wriggle hop" a spat-out player gets
        recoverBrake: 0.3,     // ...which also kills most of their forward speed
        spinBoost: 1.25,
        inhaleSlow: 0.5,
        mouthSlow: 0.8,
        dashBoost: 1.45,       // dash power: run much faster
        bounceForce: -780,     // bounce pad: launches you ~250px up
        iceDrag: 1.8,          // on ice you speed up and slow down very slowly
    };

    // Key bits sent from client to server in each command
    const KEY = { left: 1, right: 2, jump: 4, push: 8, pull: 16, interact: 32, inhale: 64, power: 128 };

    function encodeKeys(k) {
        let bits = 0;
        for (const name in KEY) if (k[name]) bits |= KEY[name];
        return bits;
    }

    function decodeKeys(bits) {
        const k = {};
        for (const name in KEY) k[name] = (bits & KEY[name]) !== 0;
        return k;
    }

    // `dir` overrides the direction we were moving (a conveyor can push a player who has vx = 0)
    function resolveHorizontal(p, world, dir) {
        const v = dir === undefined ? p.vx : dir;
        for (const tile of world.getCollidingTiles(p)) {
            if (v > 0) {
                p.x = tile.x - p.width;
                if (p.vx > 0) p.vx = 0;
            } else if (v < 0) {
                p.x = tile.x + tile.width;
                if (p.vx < 0) p.vx = 0;
            }
        }
    }

    function resolveVertical(p, world) {
        p.isGrounded = false;
        for (const tile of world.getCollidingTiles(p)) {
            if (p.vy > 0) {
                p.y = tile.y - p.height;
                if (tile.bounce) {
                    p.vy = MOVE.bounceForce;   // springs back up; never counts as standing
                } else {
                    p.vy = 0;
                    p.isGrounded = true;
                }
            } else if (p.vy < 0) {
                p.y = tile.y + tile.height;
                p.vy = 0;
            }
        }
    }

    // The platform we are standing on (for ice / conveyors), or null
    function groundTile(p, world) {
        p.y += 2;
        const tiles = world.getCollidingTiles(p);
        p.y -= 2;
        for (const t of tiles) if (Math.abs(t.y - (p.y + p.height)) <= 3) return t;
        return null;
    }

    // Advance one player by dt ms.
    //   p:     { x, y, vx, vy, width, height, isGrounded, facing, coyote, jbuf, prevJump, flapCd }
    //   keys:  { left, right, jump, inhale }
    //   world: { getCollidingTiles(p) }
    //   mods:  { spin, mouth, wings, ballistic }  (status effects the server knows about)
    //          ballistic = just spat out: flies in a straight line, no steering, for a moment
    //          spat = still in the "just spat out" state (falls slowly)
    // Returns { flapped } so the server can announce wing flaps.
    function stepMovement(p, keys, dt, world, mods) {
        mods = mods || {};
        const out = { flapped: false, recovered: false };

        if (p.flapCd > 0) p.flapCd -= dt;

        // Slower while sucking things in or carrying something; faster while spinning
        const sucking = keys.inhale && !mods.mouth;
        const speedMul = (mods.spin ? MOVE.spinBoost : 1) * (mods.dash ? MOVE.dashBoost : 1) *
            (sucking ? MOVE.inhaleSlow : (mods.mouth ? MOVE.mouthSlow : 1));

        const under = p.isGrounded ? groundTile(p, world) : null;
        const zone = world.zoneAt ? world.zoneAt(p) : null;   // wind / low gravity
        const wind = zone ? zone.vx : 0;
        const drag = under && under.ice ? MOVE.iceDrag : MOVE.drag;
        const belt = under && under.conveyor ? under.conveyor : 0;

        let targetVx = 0;
        if (keys.left) {
            targetVx = -MOVE.speed * speedMul;
            p.facing = -1;
        } else if (keys.right) {
            targetVx = MOVE.speed * speedMul;
            p.facing = 1;
        }

        // A spat-out player flies ballistically (no braking)
        if (!mods.ballistic) p.vx += (targetVx - p.vx) * drag * (dt / 1000);

        p.vy += MOVE.gravity * (mods.spat ? MOVE.spitGravity : 1) * (zone ? zone.g : 1) * (dt / 1000);
        p.vy = Math.min(p.vy, MOVE.terminal);

        // Jump input: remember a recent press so a slightly-early tap still works
        const pressed = !!keys.jump && !p.prevJump;
        p.prevJump = !!keys.jump;
        if (pressed) p.jbuf = MOVE.jumpBufferMs;
        else if (p.jbuf > 0) p.jbuf -= dt;

        const canJump = p.isGrounded || p.coyote > 0;
        if ((keys.jump || p.jbuf > 0) && canJump) {
            p.vy = MOVE.jumpForce;
            p.isGrounded = false;
            p.coyote = 0;
            p.jbuf = 0;
        } else if (pressed && p.recover > 0 && !p.isGrounded) {
            // Spat out and flying towards a pit? One hop in mid-air to brake and climb.
            p.vy = MOVE.recoverForce;
            p.vx *= MOVE.recoverBrake;
            p.recover = 0;
            out.recovered = true;
        } else if (mods.wings && !p.isGrounded) {
            // Wings: flap with a fresh press in mid-air (limited), glide while jump is held
            if (pressed && p.flapCd <= 0 && p.flaps > 0) {
                p.vy = MOVE.flapForce;
                p.flapCd = MOVE.flapCooldown;
                p.flaps--;
                out.flapped = true;
            } else if (keys.jump && p.vy > MOVE.glideFall) {
                p.vy = MOVE.glideFall;
            }
        }

        p.x += (p.vx + belt + wind) * (dt / 1000);
        resolveHorizontal(p, world, p.vx + belt + wind);

        p.y += p.vy * (dt / 1000);
        resolveVertical(p, world);

        if (p.isGrounded) {
            p.coyote = MOVE.coyoteMs;
            p.recover = 0; // safe on the ground again
        } else if (p.coyote > 0) {
            p.coyote -= dt;
        }

        return out;
    }

    // The physics-relevant fields of a player, for copying between server and client
    const FIELDS = ['x', 'y', 'vx', 'vy', 'isGrounded', 'facing', 'coyote', 'jbuf', 'prevJump', 'flapCd', 'flaps', 'recover'];

    return { MOVE, KEY, FIELDS, encodeKeys, decodeKeys, stepMovement, resolveHorizontal, resolveVertical };
});
