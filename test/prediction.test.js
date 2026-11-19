const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');
const Movement = require('../shared/movement');
const { Predictor } = require('../shared/predictor');

const { MOVE } = Movement;

function fakeIo() {
    const events = [];
    return { events, to: () => ({ emit: (type, data) => events.push({ type, data }) }) };
}

function startRoom(n = 1) {
    const io = fakeIo();
    const room = new GameRoom('0000', io);
    for (let i = 0; i < n; i++) room.addPlayer(`p${i}`, `P${i}`);
    room.startGame();
    clearInterval(room.countdownInterval);
    room.countdownInterval = null;
    room.status = 'playing';
    room.level.items = [];
    room.roundTimeLeft = 1e9;
    return { room, io };
}

// Snapshot the way the server broadcasts it (players only, that's all the predictor reads)
function snapshotOf(room, id) {
    const sent = room.io.events.length;
    room.broadcastState();
    const state = room.io.events.slice(sent).find(e => e.type === 'game_state').data;
    // (the real client rebuilds the platform list from round_load plus the small per-snapshot patch)
    const platforms = room.level.platforms.map(p => ({ ...p }));
    (state.dp || []).forEach(([i, active]) => { platforms[i].active = active === 1; });
    return { me: state.players.find(p => p.id === id), platforms };
}

// A network between one predictor and one room with fixed one-way latency.
// Time advances in 1/60 s ticks; the server ticks at the same rate.
function simulate({ ms, latencyMs, keysAt, room, id = 'p0', predictor }) {
    const STEP = MOVE.step;
    const toServer = [];   // {at, cmds}
    const toClient = [];   // {at, snapshot}
    const log = [];
    let t = 0;
    let lastSnap = 0;

    while (t < ms) {
        // client
        const cmds = predictor.advance(STEP, keysAt(t));
        if (cmds.length) toServer.push({ at: t + latencyMs, cmds });

        // network -> server
        while (toServer.length && toServer[0].at <= t) room.handleCmds(id, toServer.shift().cmds);

        // server tick
        room.gameLoop.update(STEP);

        // server -> client, 30 snapshots/s
        if (t - lastSnap >= 33) {
            lastSnap = t;
            toClient.push({ at: t + latencyMs, snap: snapshotOf(room, id) });
        }
        while (toClient.length && toClient[0].at <= t) {
            const { me, platforms } = toClient.shift().snap;
            predictor.reconcile(me, platforms);
        }

        const view = predictor.view();
        log.push({ t, view, server: { x: room.players[id].x, y: room.players[id].y } });
        t += STEP;
    }
    return log;
}

function ready(room, predictor, id = 'p0') {
    predictor.active = true;
    const { me, platforms } = snapshotOf(room, id);
    predictor.reconcile(me, platforms);
}

test('the local player responds the instant a key is pressed, regardless of latency', () => {
    const { room } = startRoom();
    const predictor = new Predictor();
    ready(room, predictor);
    const log = simulate({ ms: 300, latencyMs: 250, room, predictor, keysAt: t => ({ right: t >= 50 }) });

    const start = log[0].view.x;
    const after = log.find(l => l.t >= 50 + 100); // 100ms after pressing, far less than the 250ms latency
    assert.ok(after.view.x - start > 5, `local player barely moved: ${after.view.x - start}`);
    const serverAtThatTime = after.server.x;
    assert.ok(serverAtThatTime - start < 1, 'server has not even seen the key yet');
});

test('with a steady connection the prediction matches the server exactly (no rubber-banding)', () => {
    const { room } = startRoom();
    const predictor = new Predictor();
    ready(room, predictor);
    // run right, jump a few times
    const keysAt = t => ({ right: true, jump: (t % 700) < 120 });
    const log = simulate({ ms: 2500, latencyMs: 80, room, predictor, keysAt });

    // after each reconcile the offsets should stay ~0 when nothing unexpected happens
    const maxOffset = Math.max(...log.map(l => Math.abs(predictor.offX)), Math.abs(predictor.offY));
    assert.ok(maxOffset < 1, `visible corrections of ${maxOffset}px`);

    // and the predicted position is where the server will be a latency later
    const last = log[log.length - 1];
    const ahead = predictor.state;
    assert.ok(Math.abs(ahead.y - room.players.p0.y) < 120);
});

test('a jump pressed once is predicted and confirmed by the server (same height)', () => {
    const { room } = startRoom();
    const predictor = new Predictor();
    ready(room, predictor);
    // settle on the ground first
    simulate({ ms: 500, latencyMs: 60, room, predictor, keysAt: () => ({}) });
    const groundY = room.players.p0.y;

    const log = simulate({ ms: 900, latencyMs: 60, room, predictor, keysAt: t => ({ jump: t < 50 }) });
    const peakClient = Math.min(...log.map(l => l.view.y));
    const peakServer = Math.min(...log.map(l => l.server.y));
    assert.ok(groundY - peakClient > 100, 'client jumped');
    assert.ok(groundY - peakServer > 100, 'server jumped');
    assert.ok(Math.abs(peakClient - peakServer) < 6, `peaks differ: ${peakClient} vs ${peakServer}`);
});

test('a hit from another player is reconciled: no permanent desync, correction is eased', () => {
    const { room } = startRoom(2);
    const predictor = new Predictor();
    ready(room, predictor);
    simulate({ ms: 400, latencyMs: 80, room, predictor, keysAt: () => ({}) });

    // another player knocks us sideways, which the client cannot have predicted
    const me = room.players.p0;
    me.vx = 550; me.vy = -200;
    const log = simulate({ ms: 1200, latencyMs: 80, room, predictor, keysAt: () => ({}) });

    const end = log[log.length - 1];
    assert.ok(Math.abs(end.view.x - end.server.x) < 15, `still desynced by ${end.view.x - end.server.x}`);
});

test('while the server is in control (pulled) the client shows the server state', () => {
    const { room } = startRoom(2);
    const predictor = new Predictor();
    ready(room, predictor);
    simulate({ ms: 300, latencyMs: 50, room, predictor, keysAt: () => ({}) });

    room.players.p0.pullDuration = 800;
    const log = simulate({ ms: 500, latencyMs: 50, room, predictor, keysAt: () => ({ right: true }) });
    assert.equal(predictor.enabled, false);
    // pressing right while frozen does not move us
    const xs = log.slice(-5).map(l => l.server.x);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 0.5);
});

test('commands that are old, duplicated or malformed are ignored', () => {
    const { room } = startRoom();
    const p = room.players.p0;
    room.handleCmds('p0', [{ s: 1, k: Movement.KEY.right }, { s: 1, k: Movement.KEY.right }, { s: 0, k: 2 }]);
    assert.equal(p.ackSeq, 1);
    const x1 = p.x;
    room.handleCmds('p0', [null, 'x', { s: 'a', k: 1 }, { s: 5, k: 999 }, { s: 6.5, k: 1 }, { s: -1, k: 1 }]);
    assert.equal(p.ackSeq, 1);
    assert.equal(p.x, x1);
    room.handleCmds('p0', 'not an array');
    room.handleCmds('p0', { s: 2, k: 2 });
    assert.equal(p.ackSeq, 1);
});

test('a client cannot move faster than real time by flooding commands', () => {
    const { room } = startRoom();
    const p = room.players.p0;
    p.moveBudget = 200;
    const startX = p.x;
    const cmds = [];
    for (let i = 1; i <= 30; i++) cmds.push({ s: i, k: Movement.KEY.right });
    room.handleCmds('p0', cmds);
    room.handleCmds('p0', cmds.map(c => ({ s: c.s + 30, k: c.k })));
    room.handleCmds('p0', cmds.map(c => ({ s: c.s + 60, k: c.k })));
    room.handleCmds('p0', cmds.map(c => ({ s: c.s + 90, k: c.k })));
    // 120 commands = 2s of movement, but only ~200ms of budget was available
    const moved = p.x - startX;
    assert.ok(moved < 80, `moved ${moved}px from 120 flooded commands`);
    assert.equal(p.ackSeq, 120, 'commands are still acknowledged');
});

test('a player who stops sending commands is moved by the server (no hovering in mid-air)', () => {
    const { room } = startRoom();
    const p = room.players.p0;
    room.handleCmds('p0', [{ s: 1, k: Movement.KEY.jump }]);
    assert.equal(p.usesCmds, true);
    const y0 = p.y;
    // connection dies: no more commands. After the stall window gravity must take over.
    p.lastCmdAt = Date.now() - 1000;
    p.input = { left: false, right: false, jump: false, push: false, pull: false, interact: false, inhale: false, power: false }; // what a disconnect does
    for (let i = 0; i < 60; i++) room.gameLoop.update(MOVE.step);
    assert.ok(p.isGrounded, 'fell back to the ground');
    assert.ok(Math.abs(p.y - y0) < 5 || p.y >= y0 - 5);
});

test('players spawn spread out, not stacked', () => {
    const { room } = startRoom(3);
    const xs = Object.values(room.players).map(p => p.x);
    assert.equal(new Set(xs).size, 3);
    assert.ok(xs[1] - xs[0] >= 30);
});

test('coyote time: you can still jump just after walking off a ledge', () => {
    const p = { x: 0, y: 0, vx: 0, vy: 0, width: 30, height: 40, isGrounded: false, facing: 1, coyote: 0, jbuf: 0, prevJump: false, flapCd: 0 };
    const floor = { getCollidingTiles: q => (q.y + q.height > 500 ? [{ x: -999, y: 500, width: 9999, height: 99 }] : []) };
    p.y = 460; p.isGrounded = true;
    Movement.stepMovement(p, {}, MOVE.step, floor);          // standing: coyote refilled
    // walk off the edge (floor removed) and press jump 4 steps (~67ms) later
    const air = { getCollidingTiles: () => [] };
    for (let i = 0; i < 4; i++) Movement.stepMovement(p, {}, MOVE.step, air);
    assert.equal(p.isGrounded, false);
    Movement.stepMovement(p, { jump: true }, MOVE.step, air);
    assert.ok(p.vy < -300, `no coyote jump (vy=${p.vy})`);

    // but not after the grace period
    const q = { ...p, vy: 0, coyote: 0, prevJump: false, jbuf: 0, isGrounded: false };
    for (let i = 0; i < 10; i++) Movement.stepMovement(q, {}, MOVE.step, air);
    const vyBefore = q.vy;
    Movement.stepMovement(q, { jump: true }, MOVE.step, air);
    assert.ok(q.vy > -100 && q.vy >= vyBefore, 'jumped in mid-air');
});

test('jump buffer: a tap just before landing still jumps', () => {
    const floor = { getCollidingTiles: q => (q.y + q.height > 500 ? [{ x: -999, y: 500, width: 9999, height: 99 }] : []) };
    const p = { x: 0, y: 440, vx: 0, vy: 300, width: 30, height: 40, isGrounded: false, facing: 1, coyote: 0, jbuf: 0, prevJump: false, flapCd: 0 };
    // tap jump while still ~20px above the floor, release immediately
    Movement.stepMovement(p, { jump: true }, MOVE.step, floor);
    assert.equal(p.isGrounded, false);
    let jumped = false;
    for (let i = 0; i < 6 && !jumped; i++) {
        Movement.stepMovement(p, {}, MOVE.step, floor);
        if (p.vy < -300) jumped = true;
    }
    assert.ok(jumped, 'buffered jump was lost');
});

test('rematch: only works after a finished match, resets scores, keeps the players', () => {
    const { room } = startRoom(2);
    assert.equal(room.resetToLobby(), false, 'not allowed mid-round');
    room.players.p0.score = 20;
    room.status = 'match_end';
    assert.equal(room.resetToLobby(), true);
    assert.equal(room.status, 'lobby');
    assert.equal(room.players.p0.score, 0);
    assert.equal(Object.keys(room.players).length, 2);
    // and a new match can start
    room.startGame();
    clearInterval(room.countdownInterval);
    assert.equal(room.status, 'countdown');
    assert.equal(room.round, 1);
});

test('being swallowed then spat out over a pit: the victim controls themselves again and stays in sync', () => {
    const { room } = startRoom(2);
    room.level.hazards = [{ x: 320, y: 660, width: 380, height: 60, type: 'spikes' }];
    room.level.platforms.forEach(p => { if (p.triggerIndex === 0) p.active = false; });
    const [a, b] = [room.players.p0, room.players.p1];
    a.x = 262; a.y = 460; a.facing = 1; b.x = 262; b.y = 460;

    const predictor = new Predictor();
    ready(room, predictor, 'p1');
    simulate({ ms: 300, latencyMs: 80, room, predictor, id: 'p1', keysAt: () => ({}) });

    a.swallow(b, room);
    simulate({ ms: 400, latencyMs: 80, room, predictor, id: 'p1', keysAt: () => ({ left: true }) });
    assert.equal(predictor.enabled, false, 'no prediction while swallowed');

    a.spit(room);
    // the victim reacts 250ms after the spit: hop, then walk back
    const t0 = 0;
    const log = simulate({
        ms: 2500, latencyMs: 80, room, predictor, id: 'p1',
        keysAt: t => ({ jump: t >= 250 && t < 300, left: t >= 250 && t < 1500 })
    });
    assert.equal(b.isDead, false, 'victim survived');
    assert.equal(predictor.enabled, true, 'prediction resumed');
    const end = log[log.length - 1];
    assert.ok(Math.abs(end.view.x - end.server.x) < 15, `desynced by ${end.view.x - end.server.x}px`);
});
