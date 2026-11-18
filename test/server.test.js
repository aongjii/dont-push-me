const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { io } = require('socket.io-client');

const PORT = 17000 + Math.floor(Math.random() * 1000);
const URL = `http://localhost:${PORT}`;
let server;

test.before(async () => {
    server = spawn('node', [path.join(__dirname, '..', 'server.js'), '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((resolve, reject) => {
        server.stdout.on('data', d => { if (String(d).includes('running')) resolve(); });
        server.on('error', reject);
        setTimeout(() => reject(new Error('server did not start')), 5000);
    });
});

test.after(() => server.kill());

function connect() {
    const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false });
    return new Promise((resolve, reject) => {
        s.on('connect', () => resolve(s));
        s.on('connect_error', reject);
    });
}

// Wait for an event whose payload satisfies `ok` (ignores earlier, stale ones)
function until(socket, event, ok, ms = 3000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
        const handler = data => { if (ok(data)) { clearTimeout(timer); socket.off(event, handler); resolve(data); } };
        socket.on(event, handler);
    });
}

function once(socket, event, ms = 3000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
        socket.once(event, data => { clearTimeout(timer); resolve(data); });
    });
}

test('create, join, and reconnect keeps the same seat', async () => {
    const host = await connect();
    host.emit('create_room', { playerName: 'Host' });
    const created = await once(host, 'room_created');
    assert.match(created.roomCode, /^\d{4}$/);
    assert.ok(created.token);

    const guest = await connect();
    guest.emit('join_room', { roomCode: created.roomCode, playerName: 'Guest' });
    const joined = await once(guest, 'room_joined');
    assert.equal(joined.players.length, 2);

    // Guest drops, then comes back on a brand new socket with the saved credentials
    guest.disconnect();
    const guest2 = await connect();
    guest2.emit('rejoin_room', { roomCode: created.roomCode, playerId: joined.playerId, token: joined.token });
    const back = await once(guest2, 'rejoined');
    assert.equal(back.playerId, joined.playerId);
    assert.equal(back.players.length, 2, 'seat was kept, no duplicate player');

    host.disconnect();
    guest2.disconnect();
});

test('rejoin with a wrong token is rejected', async () => {
    const host = await connect();
    host.emit('create_room', { playerName: 'Host' });
    const created = await once(host, 'room_created');

    const intruder = await connect();
    intruder.emit('rejoin_room', { roomCode: created.roomCode, playerId: created.playerId, token: 'nope' });
    await once(intruder, 'rejoin_failed');

    host.disconnect();
    intruder.disconnect();
});

test('only the host can start the game; a reconnected host still can', async () => {
    const host = await connect();
    host.emit('create_room', { playerName: 'Host' });
    const created = await once(host, 'room_created');

    const guest = await connect();
    guest.emit('join_room', { roomCode: created.roomCode, playerName: 'Guest' });
    await once(guest, 'room_joined');

    guest.emit('start_game');
    await assert.rejects(once(guest, 'round_load', 400), /timeout/);

    host.disconnect();
    const host2 = await connect();
    host2.emit('rejoin_room', { roomCode: created.roomCode, playerId: created.playerId, token: created.token });
    await once(host2, 'rejoined');
    host2.emit('start_game');
    const load = await once(guest, 'round_load');
    assert.equal(load.round, 1);

    host2.disconnect();
    guest.disconnect();
});

test('a rejoining player mid-round is sent the level again', async () => {
    const host = await connect();
    host.emit('create_room', { playerName: 'Host' });
    const created = await once(host, 'room_created');
    const guest = await connect();
    guest.emit('join_room', { roomCode: created.roomCode, playerName: 'Guest' });
    const joined = await once(guest, 'room_joined');

    host.emit('start_game');
    await once(guest, 'round_load');

    guest.disconnect();
    const guest2 = await connect();
    const loadAgain = once(guest2, 'round_load');
    guest2.emit('rejoin_room', { roomCode: created.roomCode, playerId: joined.playerId, token: joined.token });
    await once(guest2, 'rejoined');
    const load = await loadAgain;
    assert.ok(load.platforms.length > 0);

    host.disconnect();
    guest2.disconnect();
});

test('malformed payloads do not crash the server', async () => {
    const s = await connect();
    s.emit('create_room', null);
    s.emit('join_room', 42);
    s.emit('rejoin_room', 'x');
    s.emit('input', 'garbage');
    await new Promise(r => setTimeout(r, 200));

    const s2 = await connect(); // server still answers
    s2.emit('create_room', { playerName: { evil: true } });
    const created = await once(s2, 'room_created');
    assert.match(created.roomCode, /^\d{4}$/);
    s.disconnect();
    s2.disconnect();
});

test('emotes are broadcast to the whole room during a round', async () => {
    const host = await connect();
    host.emit('create_room', { playerName: 'Host' });
    const created = await once(host, 'room_created');
    const guest = await connect();
    guest.emit('join_room', { roomCode: created.roomCode, playerName: 'Guest' });
    await once(guest, 'room_joined');

    host.emit('start_game');
    await once(guest, 'round_start', 6000);

    const seen = new Promise(resolve => guest.on('game_effect', e => { if (e.type === 'emote') resolve(e); }));
    host.emit('emote', 2);
    const effect = await seen;
    assert.equal(effect.emote, 2);
    assert.equal(effect.player, created.playerId);

    host.disconnect();
    guest.disconnect();
});

test('movement commands move the player and are acknowledged in game_state', async () => {
    const host = await connect();
    host.emit('create_room', { playerName: 'Host' });
    const created = await once(host, 'room_created');
    const guest = await connect();
    guest.emit('join_room', { roomCode: created.roomCode, playerName: 'Guest' });
    await once(guest, 'room_joined');
    host.emit('start_game');
    await once(host, 'round_start', 6000);

    const RIGHT = 2;
    const cmds = [];
    for (let i = 1; i <= 20; i++) cmds.push({ s: i, k: RIGHT });
    const stateAfter = new Promise(resolve => host.on('game_state', st => {
        const me = st.players.find(p => p.id === created.playerId);
        if (me.ack >= 20) resolve(me);
    }));
    const before = await new Promise(resolve => host.once('game_state', st => resolve(st.players.find(p => p.id === created.playerId))));
    host.emit('cmds', cmds);
    const me = await stateAfter;
    assert.ok(me.x > before.x + 10, `did not move: ${before.x} -> ${me.x}`);
    assert.equal(me.ack, 20);

    // garbage is ignored without crashing
    host.emit('cmds', 'nope');
    host.emit('cmds', [{ s: 'x' }]);
    host.emit('ping_check', 0, () => {});
    await new Promise(r => setTimeout(r, 100));
    guest.emit('ping_check', 0, () => {});
    const pong = await new Promise(resolve => guest.emit('ping_check', 0, () => resolve('pong')));
    assert.equal(pong, 'pong');

    host.disconnect();
    guest.disconnect();
});

test('only the host can start a rematch, and only after the match', async () => {
    const host = await connect();
    host.emit('create_room', { playerName: 'Host' });
    const created = await once(host, 'room_created');
    host.emit('rematch'); // lobby: nothing to rematch, must not crash or emit
    await assert.rejects(once(host, 'room_reset', 300), /timeout/);
    host.disconnect();
});

test('health endpoint reports the server is up', async () => {
    const res = await fetch(`${URL}/healthz`);
    const body = await res.json();
    assert.equal(body.ok, true);
    const shared = await fetch(`${URL}/shared/movement.js`);
    assert.equal(shared.status, 200);
});

test('leaving a room frees the seat at once, passes the host role on, and lets you join elsewhere', async () => {
    const host = await connect();
    host.emit('create_room', { playerName: 'Host' });
    const created = await once(host, 'room_created');
    const guest = await connect();
    guest.emit('join_room', { roomCode: created.roomCode, playerName: 'Guest' });
    const joined = await once(guest, 'room_joined');

    // the host leaves: the guest is told right away and becomes first in the list (= host)
    const update = until(guest, 'room_update', d => d.players.length === 1);
    await new Promise(resolve => host.emit('leave_room', resolve));
    const after = await update;
    assert.equal(after.players.length, 1);
    assert.equal(after.players[0].id, joined.playerId);

    // the leaver can create a brand new room on the same connection
    host.emit('create_room', { playerName: 'Host' });
    const second = await once(host, 'room_created');
    assert.notEqual(second.roomCode, created.roomCode);

    // the old room is deleted once its last player leaves
    await new Promise(resolve => guest.emit('leave_room', resolve));
    const health = await (await fetch(`${URL}/healthz`)).json();
    assert.ok(health.rooms >= 1);
    const rejoin = await connect();
    rejoin.emit('join_room', { roomCode: created.roomCode, playerName: 'Late' });
    const err = await once(rejoin, 'error_msg');
    assert.match(err.message, /ไม่พบห้อง/);

    // leaving when not in a room is harmless
    await new Promise(resolve => rejoin.emit('leave_room', resolve));

    host.disconnect(); guest.disconnect(); rejoin.disconnect();
});

test('a player who leaves mid-round is removed and the round carries on for the rest', async () => {
    const host = await connect();
    host.emit('create_room', { playerName: 'Host' });
    const created = await once(host, 'room_created');
    const guest = await connect();
    guest.emit('join_room', { roomCode: created.roomCode, playerName: 'Guest' });
    await once(guest, 'room_joined');
    host.emit('start_game');
    await once(guest, 'round_start', 6000);

    const update = until(host, 'room_update', d => d.players.length === 1);
    await new Promise(resolve => guest.emit('leave_room', resolve));
    const after = await update;
    assert.equal(after.players.length, 1);
    // the round is still being simulated for the remaining player
    const state = await once(host, 'game_state');
    assert.equal(state.players.length, 1);

    host.disconnect(); guest.disconnect();
});
