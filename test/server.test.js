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
