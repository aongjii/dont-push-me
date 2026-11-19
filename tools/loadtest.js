// Plays a full room of simulated players against a server and reports how it holds up.
//   node tools/loadtest.js [players=8] [seconds=20] [url]      (no url: starts a local server)
// Reports: snapshot rate each client receives, snapshot size, command acks, and (for a local
// server) the CPU it used. Real Render numbers need the url of the deployed site.
const { spawn } = require('node:child_process');
const path = require('node:path');
const { io } = require('socket.io-client');

const N = parseInt(process.argv[2] || '8', 10);
const SECONDS = parseInt(process.argv[3] || '20', 10);
let url = process.argv[4];

(async () => {
    let server = null;
    if (!url) {
        const port = 18000 + Math.floor(Math.random() * 500);
        url = `http://localhost:${port}`;
        server = spawn('node', [path.join(__dirname, '..', 'server.js'), '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
        await new Promise((res, rej) => { server.stdout.on('data', d => { if (String(d).includes('running')) res(); }); setTimeout(() => rej(new Error('server did not start')), 8000); });
    }
    const connect = () => new Promise((res, rej) => {
        const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
        s.on('connect', () => res(s)); s.on('connect_error', rej);
    });
    const once = (s, ev) => new Promise(res => s.once(ev, res));

    const clients = [];
    const host = await connect();
    host.emit('create_room', { playerName: 'P0' });
    const created = await once(host, 'room_created');
    clients.push({ s: host, id: created.playerId, snaps: 0, bytes: 0, ack: 0, seq: 0 });
    for (let i = 1; i < N; i++) {
        const s = await connect();
        s.emit('join_room', { roomCode: created.roomCode, playerName: `P${i}` });
        const j = await once(s, 'room_joined');
        clients.push({ s, id: j.playerId, snaps: 0, bytes: 0, ack: 0, seq: 0 });
    }
    clients.forEach(c => c.s.on('game_state', st => {
        c.snaps++; c.bytes += JSON.stringify(st).length;
        const me = st.players.find(p => p.id === c.id); if (me) c.ack = me.ack;
    }));
    const started = once(host, 'round_start');
    host.emit('start_game');
    await started;

    const cpuOf = () => { try { const f = require('fs').readFileSync(`/proc/${server.pid}/stat`, 'utf8').split(' '); return (+f[13] + +f[14]) / 100; } catch (e) { return null; } };
    const cpu0 = server ? cpuOf() : null;
    const t0 = Date.now();
    // every client sends ~60 key states per second in bursts of 3 per message (like the real client at 20 msgs/s)
    const timers = clients.map((c, i) => setInterval(() => {
        const cmds = [];
        for (let k = 0; k < 3; k++) cmds.push({ s: ++c.seq, k: (Math.random() < 0.6 ? 2 : 1) | (Math.random() < 0.15 ? 4 : 0) | (Math.random() < 0.05 ? 128 : 0) });
        c.s.emit('cmds', cmds);
    }, 50));
    await new Promise(r => setTimeout(r, SECONDS * 1000));
    timers.forEach(clearInterval);
    const secs = (Date.now() - t0) / 1000;

    const rate = clients.map(c => c.snaps / secs);
    const kb = clients.map(c => c.bytes / Math.max(1, c.snaps) / 1024);
    const lag = clients.map(c => c.seq - c.ack);
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    console.log(`${N} players, ${secs.toFixed(0)} s, server ${server ? 'local' : url}`);
    console.log(`snapshots per second per client: avg ${avg(rate).toFixed(1)} (min ${Math.min(...rate).toFixed(1)}), target 30`);
    console.log(`snapshot size: avg ${avg(kb).toFixed(1)} KB  ->  about ${(avg(kb) * avg(rate) * 8 / 1000).toFixed(2)} Mbit/s down per player`);
    console.log(`commands not yet acknowledged at the end: max ${Math.max(...lag)} (a few is normal)`);
    if (server) {
        const cpu1 = cpuOf();
        if (cpu0 !== null && cpu1 !== null) console.log(`server CPU: ${(100 * (cpu1 - cpu0) / secs).toFixed(0)}% of one core during the run`);
        server.kill();
    }
    clients.forEach(c => c.s.close());
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
