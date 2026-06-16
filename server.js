const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const GameRoom = require('./game/GameRoom');

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
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static frontend files from 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Global state for rooms: code -> GameRoom
const rooms = {};

// Helper to generate room code
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit code
    } while (rooms[code]);
    return code;
}

io.on('connection', (socket) => {
    let currentRoomCode = null;
    let playerId = socket.id;

    console.log(`Socket connected: ${socket.id}`);

    // Create a new room
    socket.on('create_room', ({ playerName }) => {
        const roomCode = generateRoomCode();
        const room = new GameRoom(roomCode, io);
        rooms[roomCode] = room;
        
        currentRoomCode = roomCode;
        socket.join(roomCode);

        const player = room.addPlayer(playerId, playerName || `Player 1`);
        
        socket.emit('room_created', {
            roomCode,
            playerId,
            players: Object.values(room.players).map(p => ({ id: p.id, name: p.name, color: p.color }))
        });

        console.log(`Room ${roomCode} created by ${playerName}`);
    });

    // Join an existing room
    socket.on('join_room', ({ roomCode, playerName }) => {
        const room = rooms[roomCode];
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

        currentRoomCode = roomCode;
        socket.join(roomCode);

        const name = playerName || `Player ${Object.keys(room.players).length + 1}`;
        const player = room.addPlayer(playerId, name);

        // Notify client
        socket.emit('room_joined', {
            roomCode,
            playerId,
            players: Object.values(room.players).map(p => ({ id: p.id, name: p.name, color: p.color }))
        });

        // Notify others in room
        io.to(roomCode).emit('room_update', {
            players: Object.values(room.players).map(p => ({ id: p.id, name: p.name, color: p.color }))
        });

        console.log(`${name} joined Room ${roomCode}`);
    });

    // Start Game (Only host, which is the first player in the room)
    socket.on('start_game', () => {
        if (!currentRoomCode) return;
        const room = rooms[currentRoomCode];
        if (!room) return;

        // Verify if sender is the host (first player in room)
        const hostId = Object.keys(room.players)[0];
        if (socket.id === hostId) {
            console.log(`Starting game for room ${currentRoomCode}`);
            room.startGame();
        }
    });

    // Request next round (host only)
    socket.on('next_round', () => {
        if (!currentRoomCode) return;
        const room = rooms[currentRoomCode];
        if (!room) return;

        const hostId = Object.keys(room.players)[0];
        if (socket.id === hostId) {
            room.nextRound();
        }
    });

    // Player inputs
    socket.on('input', (inputState) => {
        if (!currentRoomCode) return;
        const room = rooms[currentRoomCode];
        if (room) {
            room.handleInput(playerId, inputState);
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        if (currentRoomCode) {
            const room = rooms[currentRoomCode];
            if (room) {
                room.removePlayer(playerId);
                
                // If room empty, delete
                if (Object.keys(room.players).length === 0) {
                    console.log(`Deleting empty room: ${currentRoomCode}`);
                    delete rooms[currentRoomCode];
                } else {
                    // Notify others
                    io.to(currentRoomCode).emit('room_update', {
                        players: Object.values(room.players).map(p => ({ id: p.id, name: p.name, color: p.color }))
                    });
                }
            }
        }
    });
});

// Run server
server.listen(port, () => {
    console.log(`===============================================`);
    console.log(`🎮 Don't Push Me! server running on:`);
    console.log(`👉 http://localhost:${port}`);
    console.log(`===============================================`);
});
