// Turn every <i data-icon="..."> placeholder into our own SVG icon
Icons.hydrate();

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

function showHudAlert(text, duration = 2000, icon = null) {
    if (alertTimeout) clearTimeout(alertTimeout);
    hudAlertBox.replaceChildren();
    if (icon) hudAlertBox.appendChild(Icons.svg(icon, 20));
    hudAlertBox.appendChild(document.createTextNode(text));
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
    // If we were mid-game, the room is gone (server restarted or the room closed): back to the menu
    if (!UI.screens.menu.classList.contains('active')) {
        try { sessionStorage.setItem('dpm-notice', 'ห้องเดิมหายไปแล้ว (เซิร์ฟเวอร์รีสตาร์ทหรือห้องถูกปิด) กรุณาสร้างห้องใหม่อีกครั้ง'); } catch (e) {}
        window.location.reload();
    }
});

// Shown once after the page reloads back to the menu
try {
    const notice = sessionStorage.getItem('dpm-notice');
    if (notice) {
        sessionStorage.removeItem('dpm-notice');
        setTimeout(() => UI.showError(notice), 300);
    }
} catch (e) {}

// Keyboard state (held keys). Sent to the server as numbered commands, 60 per second.
const inputState = {
    left: false,
    right: false,
    jump: false,
    push: false,
    pull: false,
    interact: false,
    inhale: false,
    power: false
};

function clearInputs() {
    for (const k in inputState) inputState[k] = false;
}

// --- CLIENT-SIDE PREDICTION ---
// Our own character is moved right here, the instant a key is pressed, using the same physics
// code as the server (shared/movement.js). The server confirms or corrects every snapshot,
// so controls feel instant even with a slow connection. Other players are shown a moment late.
const predictor = new Predictor.Predictor();
let outbox = [];
let lastSentBits = 0;
let lastFlushAt = 0;

function pumpCommands(now, elapsedMs) {
    const cmds = predictor.advance(elapsedMs, inputState);
    if (cmds.length) outbox.push(...cmds);
    if (!outbox.length || !socket.connected) { if (!socket.connected) outbox = []; return; }

    // Send right away when a key changed, otherwise batch a couple of steps per message
    const changed = outbox[outbox.length - 1].k !== lastSentBits;
    if (changed || outbox.length >= 3 || now - lastFlushAt >= 33) {
        socket.emit('cmds', outbox);
        lastSentBits = outbox[outbox.length - 1].k;
        outbox = [];
        lastFlushAt = now;
    }
}

// (key bindings now come from KeysUI / shared/keybinds.js, so players can change them)

const EMOTES = ['laugh', 'angry', 'wave', 'skull']; // icon names (see icons.js)

function inGame() {
    return UI.screens.game.classList.contains('active');
}

const muteBtn = document.getElementById('btn-mute');
function refreshMuteButton() { Icons.set(muteBtn, Sfx.isMuted() ? 'sound_off' : 'sound_on', 22); }
refreshMuteButton();
muteBtn.addEventListener('click', () => { Sfx.toggleMute(); refreshMuteButton(); muteBtn.blur(); });

window.addEventListener('keydown', (e) => {
    if (KeysUI.isCapturing()) return; // the key-binding screen is listening for a new key
    // Don't hijack typing in the menu inputs
    if (e.target && e.target.tagName === 'INPUT') return;

    if (e.code === 'Escape') { setHelp(false); KeysUI.close(); return; }

    const action = KeysUI.actionOf(e.code);

    if (action === 'help' && !e.repeat) {
        toggleHelp();
        return;
    }

    if (action === 'mute' && !e.repeat) {
        Sfx.toggleMute();
        refreshMuteButton();
        return;
    }

    if (inGame() && !e.repeat) {
        if (action && action.startsWith('emote')) {
            socket.emit('emote', parseInt(action.slice(5), 10) - 1);
            return;
        }
        // Dead or finished: left/right switches who you are watching
        const me = gameState && gameState.players.find(p => p.id === localPlayerId);
        if (me && (me.isDead || me.isFinished)) {
            if (action === 'left') cycleSpectate(-1);
            if (action === 'right') cycleSpectate(1);
        }
    }

    if (action && action in inputState) {
        inputState[action] = true;
    }
});

// Losing focus (alt-tab, clicking elsewhere) would leave keys "stuck" held down
window.addEventListener('blur', clearInputs);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInputs(); });

window.addEventListener('keyup', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    const action = KeysUI.actionOf(e.code);
    if (action && action in inputState) {
        inputState[action] = false;
    }
});

// Helper to check if current user is room host (the first player in the room list)
function updateHostStatus(players) {
    document.getElementById('bot-row').style.display = players.length > 0 && players[0].id === localPlayerId ? 'flex' : 'none';
    setTimeout(() => { if (typeof refreshSettingsUI === 'function') refreshSettingsUI(); }, 0);
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
    socket.emit('create_room', { playerName: nameInput, skin: SkinUI.current() });
});

// Join Room
document.getElementById('btn-join').addEventListener('click', () => {
    const nameInput = document.getElementById('input-name').value.trim();
    const codeInput = document.getElementById('input-code').value.trim();

    if (!nameInput) {
        UI.showError('กรุณาใส่ชื่อเล่นของคุณก่อนเริ่มเกม!');
        return;
    }
    if (!/^\d{6}$/.test(codeInput)) {
        UI.showError('กรุณากรอกรหัสห้อง 6 หลักที่ถูกต้อง!');
        return;
    }

    UI.saveName(nameInput);
    socket.emit('join_room', { roomCode: codeInput, playerName: nameInput, skin: SkinUI.current() });
});

// Start Game (Host only)
document.getElementById('btn-start').addEventListener('click', () => {
    socket.emit('start_game');
});

// Next Round (Host only)
document.getElementById('btn-next-round').addEventListener('click', () => {
    socket.emit('next_round');
});

// Play again with the same people (host only)
document.getElementById('btn-rematch').addEventListener('click', () => {
    socket.emit('rematch');
});

socket.on('room_reset', ({ players }) => {
    predictor.active = false;
    document.getElementById('lobby-count').textContent = players.length;
    updatePlayerLobbyList(players);
    updateHostStatus(players);
    syncMySkin(players);
    document.getElementById('btn-start').disabled = players.length < 2;
    UI.showScreen('lobby');
});

socket.on('kicked', () => {
    clearSession();
    try { sessionStorage.setItem('dpm-notice', 'หัวหน้าห้องเชิญคุณออกจากห้อง'); } catch (e) {}
    window.location.reload();
});

// Leave the room (lobby, in-game and results screens all have a button)
let leaving = false;
function leaveRoom() {
    if (leaving) return;
    // Mid-round it's easy to click by accident, so ask first
    if (inGame() && !window.confirm('ออกจากห้องกลางเกม? คุณจะกลับเข้ามาที่เดิมไม่ได้')) return;
    leaving = true;
    clearInputs();
    predictor.active = false;

    const finish = () => { clearSession(); window.location.reload(); };
    // Wait for the server to confirm (so the seat is freed), but don't hang if it doesn't answer
    const fallback = setTimeout(finish, 1500);
    socket.emit('leave_room', () => { clearTimeout(fallback); finish(); });
}
document.querySelectorAll('[data-leave]').forEach(b => b.addEventListener('click', () => { b.blur(); leaveRoom(); }));

// --- SOCKET.IO EVENT HANDLERS ---

socket.on('room_created', ({ roomCode, playerId, token, players }) => {
    localPlayerId = playerId;
    currentRoomCode = roomCode;
    saveSession(roomCode, playerId, token);
    
    document.getElementById('lobby-code').textContent = roomCode;
    document.getElementById('lobby-count').textContent = players.length;
    
    updatePlayerLobbyList(players);
    updateHostStatus(players);
    syncMySkin(players);
    
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
    syncMySkin(players);
    
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
    syncMySkin(players);
    document.getElementById('btn-start').disabled = players.length < 2;

    if (status === 'lobby') UI.showScreen('lobby');
});

socket.on('room_update', ({ players }) => {
    document.getElementById('lobby-count').textContent = players.length;
    updatePlayerLobbyList(players);
    updateHostStatus(players);
    syncMySkin(players);

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

// Host-only: a small button next to each other player to remove them from the room
function kickButton(p) {
    const b = document.createElement('button');
    b.className = 'kick-btn';
    b.title = `เชิญ ${p.name} ออกจากห้อง`;
    b.appendChild(Icons.svg('kick', 20));
    b.addEventListener('click', () => {
        if (window.confirm(`เชิญ ${p.name} ออกจากห้อง?`)) socket.emit('kick', { playerId: p.id });
    });
    return b;
}

// Keep the dress-up screen in step with what the server decided for us (it can change a taken colour)
function syncMySkin(players) {
    const mine = players.find(p => p.id === localPlayerId);
    if (!mine) return;
    SkinUI.setFromServer(
        { color: mine.color, face: mine.face, hat: mine.hat, acc: mine.acc, pat: mine.pat },
        players.filter(p => p.id !== localPlayerId).map(p => p.color)
    );
}

// Changing your look in the waiting room tells everyone (debounced while you click around)
let skinTimer = null;
SkinUI.onChange((skin) => {
    if (!currentRoomCode || !UI.screens.lobby.classList.contains('active')) return;
    clearTimeout(skinTimer);
    skinTimer = setTimeout(() => socket.emit('set_skin', skin), 250);
});

// Render the Lobby User list
function updatePlayerLobbyList(players) {
    const list = document.getElementById('lobby-player-list');
    list.innerHTML = '';

    players.forEach((p, idx) => {
        const item = document.createElement('div');
        item.className = 'player-item';

        const dot = document.createElement('canvas');
        dot.className = 'player-portrait';
        dot.width = 88; dot.height = 88;
        new Renderer(dot).drawPortrait({ face: p.face, hat: p.hat, acc: p.acc, pat: p.pat }, p.color, 0);

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
        } else if (players[0].id === localPlayerId) {
            item.appendChild(kickButton(p));
        }
        if (p.bot) {
            const tag = document.createElement('span');
            tag.className = 'host-tag bot-tag';
            tag.textContent = 'BOT';
            item.insertBefore(tag, item.querySelector('.kick-btn'));
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
    predictor.active = false;
    predictor.reset();
    outbox = [];
    powerUsed = false;
    document.getElementById('power-card').style.display = 'none';
    document.getElementById('coach').style.display = 'none';
    shownLives = null;
    spectateId = null;
    prevPlayerFlags = {};
    spectateBanner.style.display = 'none';
    document.getElementById('hud-catchup').style.display = 'none';
    Sfx.stopMusic();

    // Set HUD room code
    document.getElementById('hud-code').textContent = currentRoomCode;
    document.getElementById('hud-round').textContent = `${data.round}/${data.maxRounds}`;
    TOTAL_LIVES = data.lives || 3;

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
    predictor.active = true;
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
    spectateBanner.replaceChildren(Icons.svg('eyes', 22), document.createTextNode(`กำลังดู ${target.name}  (A / D เปลี่ยนคน)`));
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

// Our own character is drawn from the prediction instead of the (older) server state
function interpolatedState(renderTime) {
    const state = interpolatedStateRaw(renderTime);
    const view = predictor.view();
    if (!state || !view) return state;
    return { ...state, players: state.players.map(p => p.id === localPlayerId ? { ...p, ...view } : p) };
}

function interpolatedStateRaw(renderTime) {
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
    fire:  { icon: 'fire',  name: 'ไฟ',      key: 'V',     how: 'พ่นลูกไฟใส่คนข้างหน้า' },
    ice:   { icon: 'ice',   name: 'น้ำแข็ง', key: 'V',     how: 'แช่แข็งคนที่อยู่ข้างหน้า' },
    spin:  { icon: 'spin',  name: 'ปั่น',    key: 'V',     how: 'หมุนติ้วชนทุกคนรอบตัวให้กระเด็น' },
    wings: { icon: 'wings', name: 'ปีก',     key: 'Space', how: 'กดกระโดดซ้ำกลางอากาศเพื่อกระพือ • กดค้างเพื่อร่อน' }
};
const POWER_MS = { fire: 15000, ice: 15000, spin: 15000, wings: 10000 };

// Whether we've used the current power yet (the card pulses until we do)
let powerUsed = false;

// Bottom-centre card that always tells you what you hold and how to use it
function updatePowerCard(localP) {
    const card = document.getElementById('power-card');
    if (!localP.power || localP.isDead || localP.isFinished) {
        card.style.display = 'none';
        TouchUI.onPower(null);
        return;
    }
    const info = POWER_INFO[localP.power];
    card.style.display = 'flex';
    Icons.set(document.getElementById('power-icon'), info.icon, 34);
    document.getElementById('power-name').textContent = `พลัง${info.name}`;
    document.getElementById('power-how').textContent = info.how;
    document.getElementById('power-key').textContent = info.key === 'V' ? KeysUI.keyName('power') : KeysUI.keyName('jump');
    document.getElementById('power-bar').style.transform =
        `scaleX(${Math.max(0, Math.min(1, localP.powerMs / POWER_MS[localP.power]))})`;
    if (localP.power === 'wings') {
        document.getElementById('power-how').textContent =
            `กระโดดซ้ำกลางอากาศเพื่อกระพือ (เหลือ ${localP.flaps} ครั้ง) • กดค้างเพื่อร่อน`;
    }
    card.classList.toggle('nudge', !powerUsed);
    TouchUI.onPower(localP.power);
    card.classList.toggle('cooling', localP.powerCd > 0);
}

// Hearts in the HUD: how many lives you have left this round
let TOTAL_LIVES = 3;
const RESPAWN_MS = 3000; // keep in step with GameRoom
let shownLives = null;
function renderLives(n) {
    if (n === shownLives) return;
    shownLives = n;
    const box = document.getElementById('hud-lives');
    box.replaceChildren();
    for (let i = 0; i < TOTAL_LIVES; i++) box.appendChild(Icons.svg(i < n ? 'heart' : 'heart_empty', 20));
}

function setCoachText(icon, text) {
    document.getElementById('coach-text').replaceChildren(Icons.svg(icon, 26), document.createTextNode(text));
}

// Big hint when you're swallowed (mash keys) or spat out over danger (hop!)
function updateCoach(p) {
    const coach = document.getElementById('coach');
    const bar = document.getElementById('coach-bar');
    if (p.swallowed) {
        coach.style.display = 'block';
        setCoachText('inhale', 'ถูกกลืนแล้ว! กดปุ่มเดิน/กระโดดรัวๆ เพื่อดิ้นออก');
        bar.style.display = 'block';
        document.getElementById('coach-fill').style.width = `${Math.min(100, (p.swallowTaps / p.tapsNeeded) * 100)}%`;
    } else if (p.spitBodyMs > 0 && p.recover > 0 && !p.isGrounded && !p.isDead) {
        coach.style.display = 'block';
        setCoachText('wind', `ถูกพ่น! กด ${KeysUI.keyName('jump')} เพื่อกระโดดเบรก!`);
        bar.style.display = 'none';
    } else if (p.mouth && !p.isDead) {
        coach.style.display = 'block';
        setCoachText('inhale', `อมไว้นานแค่ไหนก็ได้ ยิ่งนานยิ่งพ่นแรง — กด ${KeysUI.keyName('inhale')} เพื่อพ่น`);
        bar.style.display = 'block';
        document.getElementById('coach-fill').style.width = `${Math.round(p.charge * 100)}%`;
    } else if (p.isDead && p.respawnMs > 0) {
        coach.style.display = 'block';
        setCoachText('heart', `ฟื้นอีก ${Math.ceil(p.respawnMs / 1000)} วินาที (เหลือ ${p.lives} ชีวิต)`);
        bar.style.display = 'block';
        document.getElementById('coach-fill').style.width = `${Math.min(100, (1 - p.respawnMs / RESPAWN_MS) * 100)}%`;
    } else {
        coach.style.display = 'none';
    }
}

let toastTimer = null;
function showPowerToast(info) {
    const el = document.getElementById('power-toast');
    el.innerHTML = '';
    const big = document.createElement('div');
    big.className = 'toast-title';
    big.appendChild(Icons.svg(info.icon, 34));
    big.appendChild(document.createTextNode(`ได้พลัง${info.name}!`));
    const how = document.createElement('div');
    how.className = 'toast-how';
    how.textContent = info.key === 'V' ? `กดปุ่ม ${KeysUI.keyName('power')} เพื่อ${info.how}` : info.how;
    el.appendChild(big);
    el.appendChild(how);
    el.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, 4200);
}

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

    const mine = state.players.find(p => p.id === localPlayerId);
    if (mine) predictor.reconcile(mine, state.platforms);

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

        updatePowerCard(localP);
        updateCoach(localP);
        renderLives(localP.lives);
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
    const elapsed = now - lastFrame;
    const dt = Math.min(0.1, elapsed / 1000);
    lastFrame = now;

    if (levelData && UI.screens.game.classList.contains('active')) {
        pumpCommands(now, elapsed);
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
                spin: ['spin', 'ปั่นกระเด็น'], fire: ['fire', 'พ่นไฟใส่'], ice: ['ice', 'แช่แข็ง'],
                spit: ['inhale', 'พ่นเพื่อนใส่'], star: ['star', 'ปาดาวใส่']
            };
            const [icon, verb] = verbs[effect.kind] || ['push', 'ผลัก'];
            showHudAlert(`${pusher.name} ${verb} ${victim.name}!`, 2000, icon);
            Sfx.play(effect.kind === 'ice' ? 'ice' : 'push');
            renderer.triggerShake(180, 8);
            renderer.addParticles(victim.x + victim.width/2, victim.y + victim.height/2, victim.color, 12);
        }
    }

    if (effect.type === 'pull_hit') {
        const puller = gameState.players.find(p => p.id === effect.puller);
        const victim = gameState.players.find(p => p.id === effect.victim);
        if (puller && victim) {
            showHudAlert(`${puller.name} ดึงขัดขา ${victim.name}! (กดรัวๆ เพื่อสลัดหลุด)`, 2000, 'pull');
            Sfx.play('pull');
            renderer.triggerShake(120, 4);
        }
    }

    if (effect.type === 'switch_toggle') {
        const player = gameState.players.find(p => p.id === effect.player);
        if (player) {
            showHudAlert(`${player.name} สับสวิตช์สะพานแล้ว!`, 1500, 'lever');
            Sfx.play('switch');
            renderer.triggerShake(100, 3);
        }
    }

    if (effect.type === 'player_died') {
        if (effect.killerName) {
            showHudAlert(`${effect.killerName} ส่ง ${effect.name} ลงเหว! (+3)`, 2600, 'burst');
            if (effect.killerId === localPlayerId) Sfx.play('ko');
        } else {
            showHudAlert(`${effect.name} ร่วงลงหลุมตายอนาถ!`, 2000, 'skull');
        }
        const victim = gameState.players.find(p => p.id === effect.id);
        if (victim) {
            renderer.addParticles(victim.x + victim.width / 2, victim.y + victim.height / 2, victim.color, 26, { spread: 420, up: 120, size: 5 });
        }
        Sfx.play('death');
        renderer.triggerShake(200, 10);
    }

    if (effect.type === 'player_finished') {
        showHudAlert(`${effect.name} วิ่งรอดเข้าเส้นชัยสำเร็จ!`, 2000, 'flag');
        Sfx.play('finish');
    }

    if (effect.type === 'swallow') {
        const by = gameState.players.find(p => p.id === effect.by);
        if (effect.kind === 'player' && by) showHudAlert(`${effect.byName} กลืน ${effect.victimName} เข้าไปแล้ว! (กดรัวๆ เพื่อหนีออกมา)`, 2400, 'inhale');
        Sfx.play('swallow');
        if (by) renderer.triggerShake(90, 3);
    }

    if (effect.type === 'spit') {
        Sfx.play('spit');
        const by = gameState.players.find(p => p.id === effect.by);
        if (by) renderer.addParticles(by.x + by.width / 2 + by.facing * 24, by.y + by.height / 2, '#FFD94A', 8, { spread: 220, up: 40, size: 3 });
    }

    if (effect.type === 'escape') {
        showHudAlert(`${effect.name} ดิ้นหลุดออกมาได้!`, 2000, 'wind');
        Sfx.play('free');
    }

    if (effect.type === 'power_gain') {
        const info = POWER_INFO[effect.power];
        showHudAlert(`${effect.name} ได้พลัง${info.name}!`, 2400, info.icon);
        Sfx.play('power');
        if (effect.id === localPlayerId) { powerUsed = false; showPowerToast(info); }
        const p = gameState.players.find(pl => pl.id === effect.id);
        if (p) renderer.addParticles(p.x + p.width / 2, p.y + 10, '#FFD94A', 16, { spread: 300, up: 140, size: 4 });
    }

    if (effect.type === 'power_use') {
        if (effect.id === localPlayerId) powerUsed = true;
        Sfx.play({ fire: 'fire', ice: 'ice', spin: 'whirl' }[effect.power] || 'push');
    }

    if (effect.type === 'checkpoint') {
        if (effect.id === localPlayerId) {
            showHudAlert('บันทึกจุดเกิดใหม่แล้ว', 1500, 'flag');
            Sfx.play('tick');
        }
    }

    if (effect.type === 'respawn') {
        const p = gameState.players.find(pl => pl.id === effect.id);
        if (p) renderer.addParticles(p.x + p.width / 2, p.y + p.height / 2, p.color, 18, { spread: 320, up: 80, size: 4 });
        if (effect.id === localPlayerId) Sfx.play('power');
    }

    if (effect.type === 'recover') {
        Sfx.play('flap');
        const p = gameState.players.find(pl => pl.id === effect.id);
        if (p) renderer.addParticles(p.x + p.width / 2, p.y + p.height, '#FFFFFF', 10, { spread: 180, up: 20, size: 3 });
    }

    if (effect.type === 'flap') {
        if (effect.id === localPlayerId) { Sfx.play('flap'); powerUsed = true; }
    }

    if (effect.type === 'emote') {
        renderer.addEmote(effect.player, EMOTES[effect.emote]);
        if (effect.player !== localPlayerId) Sfx.play('emote');
    }
});

// Round ended screen
socket.on('round_end', ({ round, levelIndex, scoreboard, finishOrder }) => {
    Sfx.stopMusic();
    predictor.active = false;
    // Hide overlay
    document.getElementById('countdown-overlay').style.display = 'none';

    document.getElementById('end-round-num').textContent = round;

    // Fill finishers list
    const finList = document.getElementById('finishers-list');
    finList.innerHTML = '';
    
    if (finishOrder.length === 0) {
        const none = document.createElement('span');
        none.className = 'host-tip';
        none.append('ไม่มีใครรอดเลยในรอบนี้... ', Icons.svg('skull', 20));
        finList.appendChild(none);
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
        if (idx === 0) rankTd.append(Icons.svg('crown', 20), ' #1');
        else rankTd.textContent = `#${idx + 1}`;
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

    Sfx.stopMusic();
    predictor.active = false;
    Sfx.play('win');

    // Host can send everyone back to the waiting room for another match
    document.getElementById('btn-rematch').style.display = isHost ? 'inline-block' : 'none';
    document.getElementById('rematch-tip').style.display = isHost ? 'none' : 'block';
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

// --- HELP SCREEN (H, or the "วิธีเล่น" buttons) ---
const helpOverlay = document.getElementById('help-overlay');
function setHelp(open) { helpOverlay.classList.toggle('active', open); }
function toggleHelp() { setHelp(!helpOverlay.classList.contains('active')); }
document.querySelectorAll('.btn-help').forEach(b => b.addEventListener('click', () => setHelp(true)));
document.getElementById('btn-help-close').addEventListener('click', () => setHelp(false));
helpOverlay.addEventListener('click', (e) => { if (e.target === helpOverlay) setHelp(false); });

// --- PING (round trip to the server) ---
const pingEl = document.getElementById('hud-ping');
setInterval(() => {
    if (!socket.connected) { pingEl.textContent = '--'; return; }
    const t0 = performance.now();
    socket.emit('ping_check', 0, () => {
        const ms = Math.round(performance.now() - t0);
        pingEl.textContent = ms;
        pingEl.parentElement.className = 'hud-ping ' + (ms < 80 ? 'good' : ms < 160 ? 'ok' : 'bad');
    });
}, 2000);

// --- INVITE LINK: ?room=1234 fills in the room code; the lobby button copies such a link ---
(() => {
    const room = new URLSearchParams(location.search).get('room');
    if (room && /^\d{6}$/.test(room)) {
        document.getElementById('input-code').value = room;
        const note = document.getElementById('invite-note');
        note.textContent = `คุณถูกชวนเข้าห้อง ${room} - ใส่ชื่อแล้วกด "เข้าร่วมห้อง"`;
        note.style.display = 'block';
        document.getElementById('input-name').focus();
    }

    const btn = document.getElementById('btn-copy-link');
    btn.addEventListener('click', async () => {
        const url = `${location.origin}${location.pathname}?room=${currentRoomCode}`;
        let ok = false;
        try {
            await navigator.clipboard.writeText(url);
            ok = true;
        } catch (e) {
            // clipboard API unavailable (e.g. plain http): fall back to a temporary text box
            const box = document.createElement('textarea');
            box.value = url;
            document.body.appendChild(box);
            box.select();
            try { ok = document.execCommand('copy'); } catch (err) {}
            box.remove();
        }
        const label = btn.querySelector('span');
        label.textContent = ok ? 'คัดลอกแล้ว' : url;
        setTimeout(() => { label.textContent = 'คัดลอกลิงก์เชิญ'; }, 2500);
    });
})();

// --- ROOM SETTINGS (waiting room) ---
// The host picks; everyone sees. Any server message that carries `settings` updates the panel.
let roomSettings = null;
const settingsBox = document.getElementById('settings-box');

function parseSettingValue(v) {
    if (v === 'true') return true;
    if (v === 'false') return false;
    return /^\d+$/.test(v) ? parseInt(v, 10) : v;
}

function refreshSettingsUI() {
    if (!roomSettings) return;
    settingsBox.querySelectorAll('.setting-row').forEach(row => {
        const key = row.dataset.key;
        row.style.display = key === 'shuffle' && roomSettings.mode === 'survival' ? 'none' : '';
        if (key === 'rounds') {
            document.getElementById('rounds-value').textContent = roomSettings.rounds;
            document.getElementById('pool-note').textContent = roomSettings.pool ? `(มี ${roomSettings.pool} ด่านให้สุ่ม)` : '';
            row.querySelectorAll('button').forEach(btn => { btn.disabled = !isHost; });
            return;
        }
        row.querySelectorAll('button').forEach(btn => {
            btn.classList.toggle('on', parseSettingValue(btn.dataset.value) === roomSettings[key]);
            btn.disabled = !isHost;
        });
    });
    document.getElementById('settings-note').textContent = isHost ? '' : '(หัวหน้าห้องเป็นคนเลือก)';
    document.getElementById('lobby-max').textContent = roomSettings.maxPlayers;
}

socket.onAny((event, data) => {
    if (data && typeof data === 'object' && data.settings) {
        roomSettings = data.settings;
        refreshSettingsUI();
    }
});

settingsBox.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !isHost) return;
    const key = btn.closest('.setting-row').dataset.key;
    if (btn.dataset.delta) {
        const next = Math.max(1, Math.min(8, (roomSettings ? roomSettings.rounds : 3) + parseInt(btn.dataset.delta, 10)));
        socket.emit('set_settings', { rounds: next });
        return;
    }
    socket.emit('set_settings', { [key]: parseSettingValue(btn.dataset.value) });
});

document.getElementById('btn-add-bot').addEventListener('click', () => socket.emit('add_bot'));
document.getElementById('btn-remove-bot').addEventListener('click', () => socket.emit('remove_bot'));

// the in-world "press E / hold C" prompts follow the player's own keys
function syncPromptKeys() {
    renderer.keyLabels = { interact: KeysUI.keyName('interact'), inhale: KeysUI.keyName('inhale') };
}
KeysUI.onChange(syncPromptKeys);
syncPromptKeys();
