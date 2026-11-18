const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const GameRoom = require('./game/GameRoom');
const { sanitizeName, sanitizeRoomCode, createRateLimiter } = require('./game/validation');

// Parse port from arguments, env or fallback to 7488
let port = 7488;
const portArgIndex = process.argv.indexOf('--port');
if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    port = parseInt(process.argv[portArgIndex + 1], 10);
} else if (process.env.PORT) {
    port = parseInt(process.env.PORT, 10);
}

const app = express();
const server = http.createServer(app);
// The page and the socket are served from the same origin, so no CORS is needed.
// Set ALLOWED_ORIGIN (e.g. https://my-game.onrender.com) only if you host the page elsewhere.
const io = socketIo(server, process.env.ALLOWED_ORIGIN
    ? { cors: { origin: process.env.ALLOWED_ORIGIN.split(','), methods: ['GET', 'POST'] } }
    : {});

// Health check for hosting platforms (and a quick "is it up?" check for you)
app.get('/healthz', (req, res) => {
    res.json({ ok: true, rooms: Object.keys(rooms).length, uptimeSeconds: Math.round(process.uptime()) });
});

// Serve static frontend files from 'public'
app.use(express.static(path.join(__dirname, 'public')));
// Physics code shared with the browser (client-side prediction)
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// Global state for rooms: code -> GameRoom
const rooms = {};

// How long a disconnected player's seat is held for them to come back
const RECONNECT_GRACE_MS = 30 * 1000;

// Helper to generate room code
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit code
    } while (rooms[code]);
    return code;
}

// Player ids are stable across reconnects (unlike socket ids). The 'p' prefix keeps
// them from being integer-like, so object key order stays insertion order (host = first).
function generatePlayerId() {
    return 'p' + crypto.randomBytes(8).toString('hex');
}

// Socket payloads come from untrusted clients: never destructure them directly
function asObject(x) {
    return x && typeof x === 'object' ? x : {};
}

function publicPlayers(room) {
    return Object.values(room.players).map(p => ({ id: p.id, name: p.name, color: p.color }));
}

function removeFromRoom(roomCode, playerId) {
    const room = rooms[roomCode];
    if (!room || !room.players[playerId]) return;

    const player = room.players[playerId];
    if (player.graceTimer) {
        clearTimeout(player.graceTimer);
        player.graceTimer = null;
    }

    room.removePlayer(playerId);

    if (Object.keys(room.players).length === 0) {
        console.log(`Deleting empty room: ${roomCode}`);
        delete rooms[roomCode];
    } else {
        io.to(roomCode).emit('room_update', { players: publicPlayers(room) });
    }
}

io.on('connection', (socket) => {
    let currentRoomCode = null;
    let playerId = null; // set once this socket is seated in a room

    // Max 90 input/action events per second per socket (normal play sends a handful)
    const allowInput = createRateLimiter(90, 1000);
    // Room actions (create/join/rejoin/start/next) are far rarer
    const allowAction = createRateLimiter(10, 5000);

    console.log(`Socket connected: ${socket.id}`);

    function seat(room, player) {
        currentRoomCode = room.code;
        playerId = player.id;
        player.socketId = socket.id;
        player.connected = true;
        socket.join(room.code);
    }

    // Create a new room
    socket.on('create_room', (payload) => {
        const { playerName } = asObject(payload);
        if (!allowAction() || playerId) return;

        const roomCode = generateRoomCode();
        const room = new GameRoom(roomCode, io);
        rooms[roomCode] = room;

        const id = generatePlayerId();
        const player = room.addPlayer(id, sanitizeName(playerName, 'Player 1'));
        player.token = crypto.randomBytes(16).toString('hex');
        seat(room, player);

        socket.emit('room_created', {
            roomCode,
            playerId: id,
            token: player.token,
            players: publicPlayers(room)
        });

        console.log(`Room ${roomCode} created by ${player.name}`);
    });

    // Join an existing room
    socket.on('join_room', (payload) => {
        const { roomCode, playerName } = asObject(payload);
        if (!allowAction() || playerId) return;

        const code = sanitizeRoomCode(roomCode);
        const room = code && rooms[code];
        if (!room) {
            socket.emit('error_msg', { message: 'ไม่พบห้องนี้ในระบบ! กรุณาตรวจสอบรหัสห้องอีกครั้ง' });
            return;
        }

        if (room.status !== 'lobby') {
            socket.emit('error_msg', { message: 'เกมเริ่มไปแล้ว ไม่สามารถเข้าเล่นกลางคันได้!' });
            return;
        }

        if (Object.keys(room.players).length >= 4) {
            socket.emit('error_msg', { message: 'ห้องเต็มแล้ว! (รับได้สูงสุด 4 คน)' });
            return;
        }

        const id = generatePlayerId();
        const name = sanitizeName(playerName, `Player ${Object.keys(room.players).length + 1}`);
        const player = room.addPlayer(id, name);
        player.token = crypto.randomBytes(16).toString('hex');
        seat(room, player);

        // Notify client
        socket.emit('room_joined', {
            roomCode: code,
            playerId: id,
            token: player.token,
            players: publicPlayers(room)
        });

        // Notify others in room
        io.to(code).emit('room_update', { players: publicPlayers(room) });

        console.log(`${name} joined Room ${code}`);
    });

    // Take back a seat after a dropped connection or page refresh
    socket.on('rejoin_room', (payload) => {
        const { roomCode, playerId: wantedId, token } = asObject(payload);
        if (!allowAction() || playerId) return;

        const code = sanitizeRoomCode(roomCode);
        const room = code && rooms[code];
        const player = room && typeof wantedId === 'string' ? room.players[wantedId] : null;

        if (!player || typeof token !== 'string' || token !== player.token) {
            socket.emit('rejoin_failed');
            return;
        }

        // If the old socket is somehow still around, retire it
        if (player.socketId && player.socketId !== socket.id) {
            const old = io.sockets.sockets.get(player.socketId);
            if (old) old.disconnect(true);
        }

        if (player.graceTimer) {
            clearTimeout(player.graceTimer);
            player.graceTimer = null;
        }
        seat(room, player);
        // The new page numbers its commands from 1 again
        player.lastSeq = 0;
        player.ackSeq = 0;
        player.prevKeys = 0;
        player.usesCmds = false;

        socket.emit('rejoined', {
            roomCode: code,
            playerId: player.id,
            players: publicPlayers(room),
            status: room.status
        });

        // Bring the client back to whatever screen the room is on
        if (room.status === 'countdown' || room.status === 'playing') {
            socket.emit('round_load', room.getRoundLoadPayload());
            if (room.status === 'playing') socket.emit('round_start');
        } else if (room.status === 'round_end' && room.lastRoundEnd) {
            socket.emit('round_end', room.lastRoundEnd);
        } else if (room.status === 'match_end' && room.lastMatchEnd) {
            socket.emit('match_end', room.lastMatchEnd);
        }

        io.to(code).emit('room_update', { players: publicPlayers(room) });
        console.log(`${player.name} rejoined Room ${code}`);
    });

    function isHost(room) {
        return Object.keys(room.players)[0] === playerId;
    }

    // Start Game (Only host, which is the first player in the room)
    socket.on('start_game', () => {
        if (!allowAction() || !currentRoomCode) return;
        const room = rooms[currentRoomCode];
        if (!room || !isHost(room)) return;

        console.log(`Starting game for room ${currentRoomCode}`);
        room.startGame();
    });

    // Request next round (host only)
    socket.on('next_round', () => {
        if (!allowAction() || !currentRoomCode) return;
        const room = rooms[currentRoomCode];
        if (!room || !isHost(room)) return;

        room.nextRound();
    });

    // Player inputs
    socket.on('input', (inputState) => {
        if (!currentRoomCode || !allowInput()) return;
        const room = rooms[currentRoomCode];
        if (room) {
            room.handleInput(playerId, inputState);
        }
    });

    // Movement commands, a few per message (see GameRoom.handleCmds)
    socket.on('cmds', (cmds) => {
        if (!currentRoomCode || !allowInput()) return;
        const room = rooms[currentRoomCode];
        if (room) room.handleCmds(playerId, cmds);
    });

    // Latency probe for the on-screen ping display
    socket.on('ping_check', (_, ack) => {
        if (typeof ack === 'function' && allowInput()) ack();
    });

    // Host sends everyone back to the waiting room after a match
    socket.on('rematch', () => {
        if (!allowAction() || !currentRoomCode) return;
        const room = rooms[currentRoomCode];
        if (!room || !isHost(room)) return;
        if (room.resetToLobby()) io.to(currentRoomCode).emit('room_reset', { players: publicPlayers(room) });
    });

    // Quick reactions (1-4); the room enforces its own per-player cooldown
    socket.on('emote', (emote) => {
        if (!currentRoomCode || !allowInput()) return;
        const room = rooms[currentRoomCode];
        if (room) room.handleEmote(playerId, emote);
    });

    // Leave the room for good: the seat is freed right away (unlike a dropped connection,
    // which is held for a while so the player can come back)
    socket.on('leave_room', (ack) => {
        if (currentRoomCode && playerId) {
            const code = currentRoomCode;
            const leavingId = playerId;
            currentRoomCode = null;
            playerId = null;
            socket.leave(code);
            removeFromRoom(code, leavingId);
            console.log(`Player left Room ${code}`);
        }
        if (typeof ack === 'function') ack();
    });

    // Handle disconnection: hold the seat for a while so the player can come back
    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        if (!currentRoomCode || !playerId) return;

        const roomCode = currentRoomCode;
        const room = rooms[roomCode];
        const player = room && room.players[playerId];
        // Ignore if this seat was already taken over by a newer socket
        if (!player || player.socketId !== socket.id) return;

        player.connected = false;
        player.usesCmds = false; // the server moves a disconnected player itself
        // Stop any held keys so a ghost doesn't keep running
        player.input = { left: false, right: false, jump: false, push: false, pull: false, interact: false };

        const leavingId = playerId;
        player.graceTimer = setTimeout(() => removeFromRoom(roomCode, leavingId), RECONNECT_GRACE_MS);
    });
});

// Run server
server.listen(port, () => {
    console.log(`===============================================`);
    console.log(`🎮 Don't Push Me! server running on:`);
    console.log(`👉 http://localhost:${port}`);
    console.log(`===============================================`);
});
