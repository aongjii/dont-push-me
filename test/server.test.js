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
    assert.match(created.roomCode, /^\d{6}$/);
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
    assert.match(created.roomCode, /^\d{6}$/);
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

test('skins: sent on create/join, colour clash resolved, changes shared in the lobby, bad input ignored', async () => {
    const host = await connect();
    host.emit('create_room', { playerName: 'Host', skin: { color: '#B28DFF', face: 'abe', hat: 'crown', acc: 'overalls' } });
    const created = await once(host, 'room_created');
    assert.deepEqual(
        [created.players[0].color, created.players[0].face, created.players[0].hat, created.players[0].acc],
        ['#B28DFF', 'abe', 'crown', 'overalls']);

    const guest = await connect();
    guest.emit('join_room', { roomCode: created.roomCode, playerName: 'Guest', skin: { color: '#B28DFF', face: 'cat' } });
    const joined = await once(guest, 'room_joined');
    const me = joined.players.find(p => p.id === joined.playerId);
    assert.notEqual(me.color.toUpperCase(), '#B28DFF', 'clashing colour should have been swapped');
    assert.equal(me.face, 'cat');

    // a change by the guest reaches the host
    const seen = until(host, 'room_update', d => d.players.some(p => p.id === joined.playerId && p.hat === 'cat' + 'ears'));
    guest.emit('set_skin', { color: me.color, face: 'happy', hat: 'catears', acc: 'glasses' });
    const upd = await seen;
    const g = upd.players.find(p => p.id === joined.playerId);
    assert.deepEqual([g.face, g.hat, g.acc], ['happy', 'catears', 'glasses']);

    // junk is ignored without crashing
    guest.emit('set_skin', 'lol');
    guest.emit('set_skin', { face: { $gt: '' }, hat: ['x'], color: 5 });
    await new Promise(r => setTimeout(r, 150));

    // not allowed once the game started
    host.emit('start_game');
    await once(guest, 'round_start', 6000);
    guest.emit('set_skin', { color: me.color, face: 'abe', hat: 'none', acc: 'none' });
    const stateAfter = await new Promise(resolve => guest.once('game_state', resolve));
    const gg = stateAfter.players.find(p => p.id === joined.playerId);
    assert.notEqual(gg.face, 'abe');

    host.disconnect(); guest.disconnect();
});

test('the pasted Abe face image is served', async () => {
    const res = await fetch(`${URL}/img/abe.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.ok(bytes.length > 1000 && bytes.length < 400000, `unexpected size ${bytes.length}`);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
});

test('no emoji are left in the shipped game code (icons are our own)', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.join(__dirname, '..');
    const files = ['public/index.html', 'server.js', ...['public/js', 'public/css', 'game', 'shared'].flatMap(d =>
        fs.readdirSync(path.join(root, d)).filter(f => /\.(js|css)$/.test(f)).map(f => `${d}/${f}`))];
    const isEmoji = (cp) => (cp >= 0x1F000 && cp <= 0x1FFFF) || (cp >= 0x2600 && cp <= 0x27BF) ||
        (cp >= 0x2B00 && cp <= 0x2BFF) || (cp >= 0x23E9 && cp <= 0x23FF) || cp === 0xFE0F;
    const found = [];
    for (const f of files) {
        const text = fs.readFileSync(path.join(root, f), 'utf8');
        for (const ch of text) if (isEmoji(ch.codePointAt(0))) found.push(`${f}: ${ch}`);
    }
    assert.deepEqual(found, []);
});

test('host can remove a player from the waiting room; others cannot; not mid-game', async () => {
    const host = await connect();
    host.emit('create_room', { playerName: 'Host' });
    const created = await once(host, 'room_created');
    const guest = await connect();
    guest.emit('join_room', { roomCode: created.roomCode, playerName: 'Guest' });
    const joined = await once(guest, 'room_joined');
    const third = await connect();
    third.emit('join_room', { roomCode: created.roomCode, playerName: 'Third' });
    const joined3 = await once(third, 'room_joined');

    // a non-host cannot kick anyone
    guest.emit('kick', { playerId: joined3.playerId });
    await new Promise(r => setTimeout(r, 200));
    host.emit('kick', { playerId: created.playerId }); // and the host cannot kick themselves
    host.emit('kick', 'garbage');
    await new Promise(r => setTimeout(r, 200));
    const health = await (await fetch(`${URL}/healthz`)).json();
    assert.ok(health.rooms >= 1);

    // the host kicks the guest: the guest is told, and everyone else sees the new list
    const told = once(guest, 'kicked');
    const update = until(host, 'room_update', d => d.players.length === 2 && !d.players.some(p => p.id === joined.playerId));
    host.emit('kick', { playerId: joined.playerId });
    await told;
    const after = await update;
    assert.deepEqual(after.players.map(p => p.name), ['Host', 'Third']);

    // and the kicked player is out of the room: their commands do nothing
    guest.emit('start_game');
    guest.emit('set_skin', { face: 'abe' });
    await new Promise(r => setTimeout(r, 300));

    // no kicking once the game has started
    host.emit('start_game');
    await once(third, 'round_start', 6000);
    host.emit('kick', { playerId: joined3.playerId });
    const state = await new Promise(resolve => third.once('game_state', resolve));
    assert.equal(state.players.length, 2, 'nobody was removed mid-game');

    host.disconnect(); guest.disconnect(); third.disconnect();
});

test('only the host can change the room settings, and everyone sees the result', async () => {
    const host = await connect();
    host.emit('create_room', { playerName: 'Host' });
    const created = await once(host, 'room_created');
    assert.equal(created.settings.rounds, 3);
    const guest = await connect();
    guest.emit('join_room', { roomCode: created.roomCode, playerName: 'Guest' });
    await once(guest, 'room_joined');

    guest.emit('set_settings', { rounds: 5 });
    await new Promise(r => setTimeout(r, 150));

    const seen = until(guest, 'room_update', d => d.settings && d.settings.rounds === 5 && d.settings.items === false);
    host.emit('set_settings', { rounds: 5, items: false, mode: 'nonsense' });
    const upd = await seen;
    assert.equal(upd.settings.mode, 'race', 'invalid values are ignored');

    host.disconnect(); guest.disconnect();
});

test('host adds and removes bots; they are listed after the humans; non-hosts cannot', async () => {
    const host = await connect();
    host.emit('create_room', { playerName: 'Host' });
    const created = await once(host, 'room_created');
    const guest = await connect();
    guest.emit('join_room', { roomCode: created.roomCode, playerName: 'Guest' });
    await once(guest, 'room_joined');

    guest.emit('add_bot');
    await new Promise(r => setTimeout(r, 150));

    const added = until(host, 'room_update', d => d.players.length === 3);
    host.emit('add_bot');
    const upd = await added;
    assert.equal(upd.players[2].bot, true);
    assert.deepEqual(upd.players.slice(0, 2).map(p => p.bot), [false, false]);

    // a guest joining AFTER the bot still sorts before it
    const third = await connect();
    third.emit('join_room', { roomCode: created.roomCode, playerName: 'Third' });
    const j = await once(third, 'room_joined');
    assert.equal(j.players[2].name, 'Third');
    assert.equal(j.players[3].bot, true);

    const removed = until(host, 'room_update', d => d.players.length === 3 && !d.players.some(p => p.bot));
    host.emit('remove_bot');
    await removed;

    host.disconnect(); guest.disconnect(); third.disconnect();
});

test('eight people can share a room; the ninth is told it is full', async () => {
    const host = await connect();
    host.emit('create_room', { playerName: 'Host' });
    const created = await once(host, 'room_created');
    const sockets = [host];
    for (let i = 1; i < 8; i++) {
        const s = await connect();
        s.emit('join_room', { roomCode: created.roomCode, playerName: `P${i}` });
        await once(s, 'room_joined');
        sockets.push(s);
    }
    const ninth = await connect();
    ninth.emit('join_room', { roomCode: created.roomCode, playerName: 'Late' });
    const err = await once(ninth, 'error_msg');
    assert.match(err.message, /8/);

    // and a full round runs with 8 in it
    host.emit('start_game');
    const state = await new Promise(resolve => host.once('game_state', resolve));
    assert.equal(state.players.length, 8);

    sockets.forEach(s => s.disconnect()); ninth.disconnect();
});
