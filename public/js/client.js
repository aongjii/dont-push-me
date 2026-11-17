const socket = io();

// Client state variables
let localPlayerId = null;
let currentRoomCode = null;
let levelData = null;
let gameState = null;
let isHost = false;

// Renderer setup
const renderer = new Renderer('gameCanvas');

// HUD notification list
const hudAlertBox = document.getElementById('hud-alert-box');
let alertTimeout = null;

function showHudAlert(text, duration = 2000) {
    if (alertTimeout) clearTimeout(alertTimeout);
    hudAlertBox.textContent = text;
    hudAlertBox.style.display = 'block';
    alertTimeout = setTimeout(() => {
        hudAlertBox.style.display = 'none';
    }, duration);
}

// --- SESSION (reconnect support) ---
const SESSION_KEY = 'dpm-session';

function saveSession(roomCode, playerId, token) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, playerId, token })); } catch (e) {}
}

function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
}

function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
}

// On every (re)connect, try to take back our seat if we had one
socket.on('connect', () => {
    const session = loadSession();
    if (session) socket.emit('rejoin_room', session);
});

socket.on('rejoin_failed', () => {
    clearSession();
    // If we were mid-game, the room is gone: return to the menu
    if (!UI.screens.menu.classList.contains('active')) window.location.reload();
});

// Keyboard input state
const inputState = {
    left: false,
    right: false,
    jump: false,
    push: false,
    pull: false,
    interact: false
};

// Check if any keys have changed to minimize socket flood
let lastInputState = { ...inputState };

function sendInputs() {
    // Only send inputs if game is playing
    if (UI.screens.game.classList.contains('active') && gameState) {
        // We only send when inputs change OR periodically
        const hasChanged = 
            inputState.left !== lastInputState.left ||
            inputState.right !== lastInputState.right ||
            inputState.jump !== lastInputState.jump ||
            inputState.push !== lastInputState.push ||
            inputState.pull !== lastInputState.pull ||
            inputState.interact !== lastInputState.interact;

        if (hasChanged) {
            socket.emit('input', inputState);
            lastInputState = { ...inputState };
        }
    }
}

// Track keys
const keyMap = {
    // Left
    'KeyA': 'left',
    'ArrowLeft': 'left',
    // Right
    'KeyD': 'right',
    'ArrowRight': 'right',
    // Jump
    'KeyW': 'jump',
    'ArrowUp': 'jump',
    'Space': 'jump',
    // Push
    'KeyF': 'push',
    'KeyZ': 'push',
    // Pull
    'KeyG': 'pull',
    'KeyX': 'pull',
    // Interact
    'KeyE': 'interact'
};

window.addEventListener('keydown', (e) => {
    const action = keyMap[e.code];
    if (action) {
        inputState[action] = true;
        sendInputs();
    }
});

window.addEventListener('keyup', (e) => {
    const action = keyMap[e.code];
    if (action) {
        inputState[action] = false;
        sendInputs();
    }
});

// Helper to check if current user is room host (the first player in the room list)
function updateHostStatus(players) {
    if (players.length > 0 && players[0].id === localPlayerId) {
        isHost = true;
        document.getElementById('btn-start').style.display = 'inline-block';
        document.getElementById('host-tip').style.display = 'none';
    } else {
        isHost = false;
        document.getElementById('btn-start').style.display = 'none';
        document.getElementById('host-tip').style.display = 'block';
    }
}

// --- BUTTONS INTERACTIVE ACTIONS ---

// Create Room
document.getElementById('btn-create').addEventListener('click', () => {
    const nameInput = document.getElementById('input-name').value.trim();
    if (!nameInput) {
        UI.showError('กรุณาใส่ชื่อเล่นของคุณก่อนเริ่มเกม!');
        return;
    }
    UI.saveName(nameInput);
    socket.emit('create_room', { playerName: nameInput });
});

// Join Room
document.getElementById('btn-join').addEventListener('click', () => {
    const nameInput = document.getElementById('input-name').value.trim();
    const codeInput = document.getElementById('input-code').value.trim();

    if (!nameInput) {
        UI.showError('กรุณาใส่ชื่อเล่นของคุณก่อนเริ่มเกม!');
        return;
    }
    if (!codeInput || codeInput.length !== 4) {
        UI.showError('กรุณากรอกรหัสห้อง 4 หลักที่ถูกต้อง!');
        return;
    }

    UI.saveName(nameInput);
    socket.emit('join_room', { roomCode: codeInput, playerName: nameInput });
});

// Start Game (Host only)
document.getElementById('btn-start').addEventListener('click', () => {
    socket.emit('start_game');
});

// Next Round (Host only)
document.getElementById('btn-next-round').addEventListener('click', () => {
    socket.emit('next_round');
});

// Back to Menu
document.getElementById('btn-menu').addEventListener('click', () => {
    clearSession();
    window.location.reload();
});

// --- SOCKET.IO EVENT HANDLERS ---

socket.on('room_created', ({ roomCode, playerId, token, players }) => {
    localPlayerId = playerId;
    currentRoomCode = roomCode;
    saveSession(roomCode, playerId, token);
    
    document.getElementById('lobby-code').textContent = roomCode;
    document.getElementById('lobby-count').textContent = players.length;
    
    updatePlayerLobbyList(players);
    updateHostStatus(players);
    
    // Enable start game only if >= 2 players
    document.getElementById('btn-start').disabled = players.length < 2;

    UI.showScreen('lobby');
});

socket.on('room_joined', ({ roomCode, playerId, token, players }) => {
    localPlayerId = playerId;
    currentRoomCode = roomCode;
    saveSession(roomCode, playerId, token);

    document.getElementById('lobby-code').textContent = roomCode;
    document.getElementById('lobby-count').textContent = players.length;

    updatePlayerLobbyList(players);
    updateHostStatus(players);
    
    UI.showScreen('lobby');
});

// Seat recovered after a dropped connection / page refresh. The server then re-sends
// whatever the room is showing (round_load, round_end, ...), so only the lobby is handled here.
socket.on('rejoined', ({ roomCode, playerId, players, status }) => {
    localPlayerId = playerId;
    currentRoomCode = roomCode;

    document.getElementById('lobby-code').textContent = roomCode;
    document.getElementById('lobby-count').textContent = players.length;
    updatePlayerLobbyList(players);
    updateHostStatus(players);
    document.getElementById('btn-start').disabled = players.length < 2;

    if (status === 'lobby') UI.showScreen('lobby');
});

socket.on('room_update', ({ players }) => {
    document.getElementById('lobby-count').textContent = players.length;
    updatePlayerLobbyList(players);
    updateHostStatus(players);

    // Enable start game only if >= 2 players
    document.getElementById('btn-start').disabled = players.length < 2;
});

socket.on('error_msg', ({ message }) => {
    UI.showError(message);
});

// Render the Lobby User list
function updatePlayerLobbyList(players) {
    const list = document.getElementById('lobby-player-list');
    list.innerHTML = '';

    players.forEach((p, idx) => {
        const item = document.createElement('div');
        item.className = 'player-item';
        item.style.borderLeftColor = p.color;

        const dot = document.createElement('div');
        dot.className = 'player-dot';
        dot.style.backgroundColor = p.color;

        const name = document.createElement('span');
        name.className = 'player-name';
        name.textContent = p.name;
        if (p.id === localPlayerId) {
            name.textContent += ' (คุณ)';
        }

        item.appendChild(dot);
        item.appendChild(name);

        if (idx === 0) {
            const host = document.createElement('span');
            host.className = 'host-tag';
            host.textContent = 'HOST';
            item.appendChild(host);
        }

        list.appendChild(item);
    });
}

// --- GAMEPLAY TRIGGERS ---

// Loaded Level info
socket.on('round_load', (data) => {
    levelData = data;
    gameState = null;
    snapshots.length = 0;

    // Set HUD room code
    document.getElementById('hud-code').textContent = currentRoomCode;
    document.getElementById('hud-round').textContent = `${data.round}/${data.maxRounds}`;

    // Switch screen to game
    UI.showScreen('game');

    // Show countdown display
    document.getElementById('countdown-overlay').style.display = 'flex';
    document.getElementById('countdown-text').textContent = '3';
});

// Tick countdown
socket.on('countdown', ({ timer }) => {
    const txt = document.getElementById('countdown-text');
    if (timer <= 0) {
        txt.textContent = 'RUN!';
    } else {
        txt.textContent = timer;
    }
});

// Round Start (Release movement)
socket.on('round_start', () => {
    document.getElementById('countdown-overlay').style.display = 'none';
});

// --- STATE SNAPSHOTS + INTERPOLATION ---
// The server sends ~30 states/sec. Drawing each one the moment it arrives makes motion
// stutter whenever packets are uneven, so we keep a short buffer and draw slightly in the
// past, blending between the two snapshots around that moment.
const INTERP_DELAY_MS = 75;
const snapshots = []; // { t: arrival time (ms), state }

function lerp(a, b, f) { return a + (b - a) * f; }

function interpolatedState(renderTime) {
    if (snapshots.length === 0) return null;
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    if (renderTime <= first.t) return first.state;
    if (renderTime >= last.t) return last.state; // no extrapolation: hold the newest state

    let i = snapshots.length - 1;
    while (i > 0 && snapshots[i - 1].t > renderTime) i--;
    const a = snapshots[i - 1];
    const b = snapshots[i];
    const f = (renderTime - a.t) / (b.t - a.t || 1);

    const players = b.state.players.map(pb => {
        const pa = a.state.players.find(p => p.id === pb.id);
        // Don't smear across big jumps (respawn, teleport)
        if (!pa || Math.abs(pb.x - pa.x) > 300 || Math.abs(pb.y - pa.y) > 300) return pb;
        return { ...pb, x: lerp(pa.x, pb.x, f), y: lerp(pa.y, pb.y, f) };
    });

    const hazards = b.state.hazards.map((hb, idx) => {
        const ha = a.state.hazards[idx];
        return ha ? { ...hb, x: lerp(ha.x, hb.x, f), y: lerp(ha.y, hb.y, f) } : hb;
    });

    const lavaY = (a.state.lavaY !== null && b.state.lavaY !== null)
        ? lerp(a.state.lavaY, b.state.lavaY, f)
        : b.state.lavaY;

    return { ...b.state, players, hazards, lavaY };
}

socket.on('game_state', (state) => {
    gameState = state;
    snapshots.push({ t: performance.now(), state });
    // Keep ~1 second of history
    while (snapshots.length > 40) snapshots.shift();

    // Update HUD Cooldown progress bars
    const localP = state.players.find(p => p.id === localPlayerId);
    if (localP) {
        // Push cooldown max 1200ms
        const pushPct = Math.min(100, Math.max(0, (localP.pushCooldown / 1200) * 100));
        document.getElementById('cooldown-push').style.height = `${pushPct}%`;

        // Pull cooldown max 2500ms
        const pullPct = Math.min(100, Math.max(0, (localP.pullCooldown / 2500) * 100));
        document.getElementById('cooldown-pull').style.height = `${pullPct}%`;
    }

    // Round timer
    const timerEl = document.getElementById('hud-timer');
    timerEl.textContent = state.timeLeft;
    timerEl.parentElement.classList.toggle('urgent', state.timeLeft <= 10);
});

// Render loop: runs every display frame, independent of network rate
let lastFrame = performance.now();
function renderFrame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    if (levelData && UI.screens.game.classList.contains('active')) {
        const state = interpolatedState(now - INTERP_DELAY_MS);
        if (state) renderer.draw(state, localPlayerId, levelData, dt);
    }
    requestAnimationFrame(renderFrame);
}
requestAnimationFrame(renderFrame);

// Trigger sounds / screen shakes on visual events
socket.on('game_effect', (effect) => {
    if (!gameState || !levelData) return;

    if (effect.type === 'push_hit') {
        const pusher = gameState.players.find(p => p.id === effect.pusher);
        const victim = gameState.players.find(p => p.id === effect.victim);
        if (pusher && victim) {
            showHudAlert(`💥 ${pusher.name} ผลัก ${victim.name}!`);
            renderer.triggerShake(180, 8);
            renderer.addParticles(victim.x + victim.width/2, victim.y + victim.height/2, victim.color, 12);
        }
    }

    if (effect.type === 'pull_hit') {
        const puller = gameState.players.find(p => p.id === effect.puller);
        const victim = gameState.players.find(p => p.id === effect.victim);
        if (puller && victim) {
            showHudAlert(`🧲 ${puller.name} ดึงขัดขา ${victim.name}!`);
            renderer.triggerShake(120, 4);
        }
    }

    if (effect.type === 'switch_toggle') {
        const player = gameState.players.find(p => p.id === effect.player);
        if (player) {
            showHudAlert(`🔘 ${player.name} สับสวิตช์สะพานแล้ว!`, 1500);
            renderer.triggerShake(100, 3);
        }
    }

    if (effect.type === 'player_died') {
        showHudAlert(`💀 ${effect.name} ร่วงลงหลุมตายอนาถ!`);
        renderer.triggerShake(200, 10);
    }

    if (effect.type === 'player_finished') {
        showHudAlert(`🎉 ${effect.name} วิ่งรอดเข้าเส้นชัยสำเร็จ!`);
    }
});

// Round ended screen
socket.on('round_end', ({ round, levelIndex, scoreboard, finishOrder }) => {
    // Hide overlay
    document.getElementById('countdown-overlay').style.display = 'none';

    document.getElementById('end-round-num').textContent = round;

    // Fill finishers list
    const finList = document.getElementById('finishers-list');
    finList.innerHTML = '';
    
    if (finishOrder.length === 0) {
        finList.innerHTML = '<span class="host-tip">ไม่มีใครรอดเลยในรอบนี้... 💀</span>';
    } else {
        finishOrder.forEach((name, idx) => {
            const badge = document.createElement('span');
            badge.className = 'finisher-badge';
            badge.textContent = `#${idx + 1} ${name}`;
            finList.appendChild(badge);
        });
    }

    // Fill Scoreboard
    const tbody = document.getElementById('round-scoreboard-body');
    tbody.innerHTML = '';

    scoreboard.forEach((p, idx) => {
        const tr = document.createElement('tr');
        
        const rankTd = document.createElement('td');
        rankTd.textContent = `#${idx + 1}`;
        rankTd.style.fontWeight = 'bold';
        if (idx === 0) rankTd.style.color = '#ffcc00';

        const nameTd = document.createElement('td');
        nameTd.style.color = p.color;
        nameTd.style.fontWeight = 'bold';
        nameTd.textContent = p.name;
        if (p.id === localPlayerId) {
            nameTd.textContent += ' (คุณ)';
        }

        const roundTd = document.createElement('td');
        roundTd.textContent = `+${p.roundPoints}`;
        roundTd.style.color = p.roundPoints > 0 ? '#2ecc71' : '#ff4d4d';

        const totalTd = document.createElement('td');
        totalTd.textContent = p.totalScore;
        totalTd.style.fontWeight = 'bold';

        tr.appendChild(rankTd);
        tr.appendChild(nameTd);
        tr.appendChild(roundTd);
        tr.appendChild(totalTd);

        tbody.appendChild(tr);
    });

    // Check if current user is Host to show "Next Level" button
    const nextBtn = document.getElementById('btn-next-round');
    const hostTip = document.getElementById('next-round-tip');
    
    if (isHost) {
        nextBtn.style.display = 'inline-block';
        hostTip.style.display = 'none';
    } else {
        nextBtn.style.display = 'none';
        hostTip.style.display = 'block';
    }

    UI.showScreen('roundEnd');
});

// Match ended Champion announcement
socket.on('match_end', ({ scoreboard, winner }) => {
    document.getElementById('match-winner').textContent = winner.name;
    document.getElementById('match-winner').style.color = winner.color;

    const tbody = document.getElementById('match-scoreboard-body');
    tbody.innerHTML = '';

    scoreboard.forEach((p, idx) => {
        const tr = document.createElement('tr');

        const rankTd = document.createElement('td');
        rankTd.textContent = idx === 0 ? '👑 #1' : `#${idx + 1}`;
        rankTd.style.fontWeight = 'bold';
        if (idx === 0) rankTd.style.color = '#ffcc00';

        const nameTd = document.createElement('td');
        nameTd.style.color = p.color;
        nameTd.style.fontWeight = 'bold';
        nameTd.textContent = p.name;
        if (p.id === localPlayerId) {
            nameTd.textContent += ' (คุณ)';
        }

        const scoreTd = document.createElement('td');
        scoreTd.textContent = p.totalScore;
        scoreTd.style.fontWeight = 'bold';

        tr.appendChild(rankTd);
        tr.appendChild(nameTd);
        tr.appendChild(scoreTd);

        tbody.appendChild(tr);
    });

    clearSession(); // match is over: nothing left to rejoin
    UI.showScreen('matchEnd');
});
