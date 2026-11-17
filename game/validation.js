const INPUT_KEYS = ['left', 'right', 'jump', 'push', 'pull', 'interact', 'inhale'];

// Keep only known boolean input keys; ignore anything else a client sends.
function sanitizeInput(raw) {
    const clean = {};
    if (!raw || typeof raw !== 'object') return clean;
    for (const key of INPUT_KEYS) {
        if (key in raw) clean[key] = raw[key] === true;
    }
    return clean;
}

function sanitizeName(raw, fallback) {
    if (typeof raw !== 'string') return fallback;
    // strip control characters, collapse whitespace, cap length
    const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
    return name || fallback;
}

function sanitizeRoomCode(raw) {
    const code = typeof raw === 'number' ? String(raw) : raw;
    return typeof code === 'string' && /^\d{4}$/.test(code) ? code : null;
}

// Simple fixed-window limiter: allow `max` events per `windowMs`.
function createRateLimiter(max, windowMs, now = Date.now) {
    let windowStart = now();
    let count = 0;
    return function allow() {
        const t = now();
        if (t - windowStart >= windowMs) {
            windowStart = t;
            count = 0;
        }
        count++;
        return count <= max;
    };
}

const EMOTE_COUNT = 4; // client shows 😂 😡 👋 💀 for 1-4

function sanitizeEmote(raw) {
    return Number.isInteger(raw) && raw >= 0 && raw < EMOTE_COUNT ? raw : null;
}

module.exports = { INPUT_KEYS, EMOTE_COUNT, sanitizeEmote, sanitizeInput, sanitizeName, sanitizeRoomCode, createRateLimiter };
