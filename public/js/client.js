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
    interact: false,
    inhale: false
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
            inputState.interact !== lastInputState.interact ||
            inputState.inhale !== lastInputState.inhale;

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
    'KeyE': 'interact',
    // Inhale (hold) / spit (press again)
    'KeyC': 'inhale',
    'KeyV': 'inhale'
};

const EMOTES = ['😂', '😡', '👋', '💀'];
const emoteKeys = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 };

function inGame() {
    return UI.screens.game.classList.contains('active');
}

const muteBtn = document.getElementById('btn-mute');
function refreshMuteButton() { muteBtn.textContent = Sfx.isMuted() ? '🔇' : '🔊'; }
refreshMuteButton();
muteBtn.addEventListener('click', () => { Sfx.toggleMute(); refreshMuteButton(); muteBtn.blur(); });

window.addEventListener('keydown', (e) => {
    // Don't hijack typing in the menu inputs
    if (e.target && e.target.tagName === 'INPUT') return;

    if (e.code === 'KeyM' && !e.repeat) {
        Sfx.toggleMute();
        refreshMuteButton();
        return;
    }

    if (inGame() && !e.repeat) {
        if (e.code in emoteKeys) {
            socket.emit('emote', emoteKeys[e.code]);
            return;
        }
        // Dead or finished: left/right switches who you are watching
        const me = gameState && gameState.players.find(p => p.id === localPlayerId);
        if (me && (me.isDead || me.isFinished)) {
            if (e.code === 'KeyA' || e.code === 'ArrowLeft') cycleSpectate(-1);
            if (e.code === 'KeyD' || e.code === 'ArrowRight') cycleSpectate(1);
        }
    }

    const action = keyMap[e.code];
    if (action) {
        inputState[action] = true;
        sendInputs();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
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

// A table cell with the player's colour dot and name (pastel colours are too light to use as text)
function nameCell(p) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'name-cell';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.color;
    const label = document.createElement('span');
    label.textContent = p.name + (p.id === localPlayerId ? ' (คุณ)' : '');
    wrap.appendChild(dot);
    wrap.appendChild(label);
    td.appendChild(wrap);
    return td;
}

// Render the Lobby User list
function updatePlayerLobbyList(players) {
    const list = document.getElementById('lobby-player-list');
    list.innerHTML = '';

    players.forEach((p, idx) => {
        const item = document.createElement('div');
        item.className = 'player-item';

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
    renderer.setTheme(data.theme);
    gameState = null;
    snapshots.length = 0;
    spectateId = null;
    prevPlayerFlags = {};
    spectateBanner.style.display = 'none';
    document.getElementById('hud-catchup').style.display = 'none';
    Sfx.stopMusic();

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
        Sfx.play('go');
    } else {
        txt.textContent = timer;
        Sfx.play('tick');
    }
});

// Round Start (Release movement)
socket.on('round_start', () => {
    document.getElementById('countdown-overlay').style.display = 'none';
    Sfx.startMusic();
});

// --- SPECTATING (after you die or finish) ---
let spectateId = null;
const spectateBanner = document.getElementById('hud-spectate');

function spectateCandidates(state) {
    return state.players.filter(p => p.id !== localPlayerId && !p.isDead && !p.isFinished);
}

function cycleSpectate(dir) {
    if (!gameState) return;
    const list = spectateCandidates(gameState);
    if (list.length === 0) return;
    const idx = list.findIndex(p => p.id === spectateId);
    spectateId = list[(idx + dir + list.length) % list.length].id;
}

// Returns the id the camera should follow, and updates the "watching" banner
function updateSpectate(state) {
    const me = state.players.find(p => p.id === localPlayerId);
    if (!me || (!me.isDead && !me.isFinished)) {
        spectateId = null;
        spectateBanner.style.display = 'none';
        return localPlayerId;
    }
    const list = spectateCandidates(state);
    if (!list.some(p => p.id === spectateId)) {
        spectateId = list.length ? list[0].id : null;
    }
    const target = list.find(p => p.id === spectateId);
    if (!target) {
        spectateBanner.style.display = 'none';
        return localPlayerId;
    }
    spectateBanner.textContent = `👀 กำลังดู ${target.name}  (A / D เปลี่ยนคน)`;
    spectateBanner.style.display = 'block';
    return target.id;
}

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

    const lerpById = (listB, listA) => (listB || []).map(eb => {
        const ea = (listA || []).find(e => e.id === eb.id);
        return ea && Math.abs(eb.x - ea.x) < 300 ? { ...eb, x: lerp(ea.x, eb.x, f), y: lerp(ea.y, eb.y, f) } : eb;
    });
    const projectiles = lerpById(b.state.projectiles, a.state.projectiles);
    const items = lerpById(b.state.items, a.state.items);

    const lavaY = (a.state.lavaY !== null && b.state.lavaY !== null)
        ? lerp(a.state.lavaY, b.state.lavaY, f)
        : b.state.lavaY;

    return { ...b.state, players, hazards, lavaY, projectiles, items };
}

const POWER_INFO = {
    fire:  { icon: '🔥', key: 'F', name: 'ไฟ' },
    ice:   { icon: '❄️', key: 'F', name: 'น้ำแข็ง' },
    spin:  { icon: '🌀', key: 'F', name: 'ปั่น' },
    wings: { icon: '🪽', key: 'ลอย', name: 'ปีก' }
};
const POWER_MS = { fire: 15000, ice: 15000, spin: 15000, wings: 10000 };

// Last-seen per-player flags, to detect jumps / landings / breaking free between states
let prevPlayerFlags = {};
let prevTimeLeft = null;

function detectMotionEffects(state) {
    state.players.forEach(p => {
        const prev = prevPlayerFlags[p.id];
        prevPlayerFlags[p.id] = { grounded: p.isGrounded, pulled: p.pullDuration > 0 };
        if (!prev || p.isDead || p.isFinished) return;
        const isLocal = p.id === localPlayerId;
        const feetX = p.x + p.width / 2;
        const feetY = p.y + p.height;

        if (!prev.grounded && p.isGrounded && p.vy >= 0) {
            renderer.addParticles(feetX, feetY, '#cbd5e0', 5, { spread: 120, up: 10, size: 2 });
            if (isLocal) Sfx.play('land');
        } else if (prev.grounded && !p.isGrounded && p.vy < -100) {
            renderer.addParticles(feetX, feetY, '#cbd5e0', 4, { spread: 90, up: 5, size: 2 });
            if (isLocal) Sfx.play('jump');
        }
        if (isLocal && prev.pulled && !p.pullDuration) Sfx.play('free');
    });
}

socket.on('game_state', (state) => {
    gameState = state;
    snapshots.push({ t: performance.now(), state });
    // Keep ~1 second of history
    while (snapshots.length > 40) snapshots.shift();

    detectMotionEffects(state);

    // Update HUD Cooldown progress bars (max differs when the catch-up boost is active)
    const localP = state.players.find(p => p.id === localPlayerId);
    if (localP) {
        const pushPct = Math.min(100, Math.max(0, (localP.pushCooldown / localP.pushCooldownMax) * 100));
        document.getElementById('cooldown-push').style.height = `${pushPct}%`;

        const pullPct = Math.min(100, Math.max(0, (localP.pullCooldown / localP.pullCooldownMax) * 100));
        document.getElementById('cooldown-pull').style.height = `${pullPct}%`;

        document.getElementById('hud-catchup').style.display =
            localP.catchUp && !localP.isDead && !localP.isFinished ? 'block' : 'none';

        // Inhale slot lights up while sucking or when something is in your mouth
        document.getElementById('ability-inhale').classList.toggle('active', localP.inhaling || !!localP.mouth);

        // Power slot: icon + how much time is left
        const powerSlot = document.getElementById('ability-power');
        if (localP.power && !localP.isDead && !localP.isFinished) {
            const info = POWER_INFO[localP.power];
            powerSlot.style.display = 'flex';
            document.getElementById('power-icon').textContent = info.icon;
            document.getElementById('power-label').textContent = info.key;
            const total = POWER_MS[localP.power];
            document.getElementById('power-bar').style.transform = `scaleX(${Math.max(0, Math.min(1, localP.powerMs / total))})`;
        } else {
            powerSlot.style.display = 'none';
        }
    }

    // Round timer (+ a tick each second in the last 10)
    const timerEl = document.getElementById('hud-timer');
    timerEl.textContent = state.timeLeft;
    timerEl.parentElement.classList.toggle('urgent', state.timeLeft <= 10);
    if (state.timeLeft <= 10 && state.timeLeft !== prevTimeLeft && state.timeLeft > 0) Sfx.play('hurry');
    prevTimeLeft = state.timeLeft;
});

// Render loop: runs every display frame, independent of network rate
let lastFrame = performance.now();
function renderFrame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    if (levelData && UI.screens.game.classList.contains('active')) {
        const state = interpolatedState(now - INTERP_DELAY_MS);
        if (state) renderer.draw(state, localPlayerId, levelData, dt, updateSpectate(state));
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
            const verbs = {
                spin: '🌀 ปั่นกระเด็น', fire: '🔥 พ่นไฟใส่', ice: '❄️ แช่แข็ง',
                spit: '🎳 พ่นเพื่อนใส่', star: '⭐ ปาดาวใส่'
            };
            const [icon, ...verb] = (verbs[effect.kind] || '💥 ผลัก').split(' ');
            showHudAlert(`${icon} ${pusher.name} ${verb.join(' ')} ${victim.name}!`);
            Sfx.play(effect.kind === 'ice' ? 'ice' : 'push');
            renderer.triggerShake(180, 8);
            renderer.addParticles(victim.x + victim.width/2, victim.y + victim.height/2, victim.color, 12);
        }
    }

    if (effect.type === 'pull_hit') {
        const puller = gameState.players.find(p => p.id === effect.puller);
        const victim = gameState.players.find(p => p.id === effect.victim);
        if (puller && victim) {
            showHudAlert(`🧲 ${puller.name} ดึงขัดขา ${victim.name}! (กดรัวๆ เพื่อสลัดหลุด)`);
            Sfx.play('pull');
            renderer.triggerShake(120, 4);
        }
    }

    if (effect.type === 'switch_toggle') {
        const player = gameState.players.find(p => p.id === effect.player);
        if (player) {
            showHudAlert(`🔘 ${player.name} สับสวิตช์สะพานแล้ว!`, 1500);
            Sfx.play('switch');
            renderer.triggerShake(100, 3);
        }
    }

    if (effect.type === 'player_died') {
        if (effect.killerName) {
            showHudAlert(`😈 ${effect.killerName} ส่ง ${effect.name} ลงเหว! (+3)`, 2600);
            if (effect.killerId === localPlayerId) Sfx.play('ko');
        } else {
            showHudAlert(`💀 ${effect.name} ร่วงลงหลุมตายอนาถ!`);
        }
        const victim = gameState.players.find(p => p.id === effect.id);
        if (victim) {
            renderer.addParticles(victim.x + victim.width / 2, victim.y + victim.height / 2, victim.color, 26, { spread: 420, up: 120, size: 5 });
        }
        Sfx.play('death');
        renderer.triggerShake(200, 10);
    }

    if (effect.type === 'player_finished') {
        showHudAlert(`🎉 ${effect.name} วิ่งรอดเข้าเส้นชัยสำเร็จ!`);
        Sfx.play('finish');
    }

    if (effect.type === 'swallow') {
        const by = gameState.players.find(p => p.id === effect.by);
        if (effect.kind === 'player' && by) showHudAlert(`😮 ${effect.byName} กลืน ${effect.victimName} เข้าไปแล้ว! (กดรัวๆ เพื่อหนีออกมา)`, 2400);
        Sfx.play('swallow');
        if (by) renderer.triggerShake(90, 3);
    }

    if (effect.type === 'spit') {
        Sfx.play('spit');
        const by = gameState.players.find(p => p.id === effect.by);
        if (by) renderer.addParticles(by.x + by.width / 2 + by.facing * 24, by.y + by.height / 2, '#FFD94A', 8, { spread: 220, up: 40, size: 3 });
    }

    if (effect.type === 'escape') {
        showHudAlert(`💨 ${effect.name} ดิ้นหลุดออกมาได้!`);
        Sfx.play('free');
    }

    if (effect.type === 'power_gain') {
        const info = POWER_INFO[effect.power];
        showHudAlert(`⭐ ${effect.name} ได้พลัง ${info.icon} ${info.name}!`, 2400);
        Sfx.play('power');
        const p = gameState.players.find(pl => pl.id === effect.id);
        if (p) renderer.addParticles(p.x + p.width / 2, p.y + 10, '#FFD94A', 16, { spread: 300, up: 140, size: 4 });
    }

    if (effect.type === 'power_use') {
        Sfx.play({ fire: 'fire', ice: 'ice', spin: 'whirl' }[effect.power] || 'push');
    }

    if (effect.type === 'flap') {
        if (effect.id === localPlayerId) Sfx.play('flap');
    }

    if (effect.type === 'emote') {
        renderer.addEmote(effect.player, EMOTES[effect.emote]);
        if (effect.player !== localPlayerId) Sfx.play('emote');
    }
});

// Round ended screen
socket.on('round_end', ({ round, levelIndex, scoreboard, finishOrder }) => {
    Sfx.stopMusic();
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
        rankTd.style.fontWeight = '700';

        const nameTd = nameCell(p);

        const roundTd = document.createElement('td');
        roundTd.textContent = `+${p.roundPoints}` + (p.kos > 0 ? ` (KO ×${p.kos})` : '');
        roundTd.className = p.roundPoints > 0 ? 'points-gain' : 'points-none';

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
    document.getElementById('match-winner').style.background = winner.color;

    const tbody = document.getElementById('match-scoreboard-body');
    tbody.innerHTML = '';

    scoreboard.forEach((p, idx) => {
        const tr = document.createElement('tr');

        const rankTd = document.createElement('td');
        rankTd.textContent = idx === 0 ? '👑 #1' : `#${idx + 1}`;
        rankTd.style.fontWeight = '700';

        const nameTd = nameCell(p);

        const scoreTd = document.createElement('td');
        scoreTd.textContent = p.totalScore;
        scoreTd.style.fontWeight = 'bold';

        tr.appendChild(rankTd);
        tr.appendChild(nameTd);
        tr.appendChild(scoreTd);

        tbody.appendChild(tr);
    });

    clearSession(); // match is over: nothing left to rejoin
    Sfx.stopMusic();
    Sfx.play('win');
    UI.showScreen('matchEnd');
});

// --- MENU MASCOTS: the four blobs bounce on the title screen ---
const mascotRenderer = new Renderer('menu-mascots');
const MASCOT_COLORS = ['#FF7EA8', '#5BB8FF', '#FFC93C', '#6FD98C'];
function mascotLoop(now) {
    if (UI.screens.menu.classList.contains('active')) {
        mascotRenderer.drawMascots(now / 1000, MASCOT_COLORS);
    }
    requestAnimationFrame(mascotLoop);
}
requestAnimationFrame(mascotLoop);
