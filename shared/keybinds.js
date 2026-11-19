// Keyboard bindings: which keys do what. Pure logic (no DOM) so it can be tested in Node.
// UMD: require() in Node, window.Keybinds in the browser.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Keybinds = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const SLOTS = 3; // every action can have up to three keys

    // `core` actions must always have at least one key, or you couldn't play
    const ACTIONS = [
        { id: 'left',     name: 'เดินซ้าย',          core: true },
        { id: 'right',    name: 'เดินขวา',          core: true },
        { id: 'jump',     name: 'กระโดด',           core: true },
        { id: 'push',     name: 'ผลัก',             core: true },
        { id: 'pull',     name: 'ดึง',              core: true },
        { id: 'inhale',   name: 'อม / พ่น',          core: true },
        { id: 'power',    name: 'ใช้พลังจากดาว',      core: true },
        { id: 'interact', name: 'สับสวิตช์',          core: true },
        { id: 'emote1',   name: 'อีโมจิ 1 (หัวเราะ)', core: false },
        { id: 'emote2',   name: 'อีโมจิ 2 (โกรธ)',    core: false },
        { id: 'emote3',   name: 'อีโมจิ 3 (โบกมือ)',  core: false },
        { id: 'emote4',   name: 'อีโมจิ 4 (กะโหลก)',  core: false },
        { id: 'mute',     name: 'เปิด/ปิดเสียง',      core: false },
        { id: 'help',     name: 'เปิดหน้าวิธีเล่น',     core: false }
    ];

    const DEFAULTS = {
        left: ['KeyA', 'ArrowLeft'],
        right: ['KeyD', 'ArrowRight'],
        jump: ['Space', 'KeyW', 'ArrowUp'],
        push: ['KeyF', 'KeyZ'],
        pull: ['KeyG', 'KeyX'],
        inhale: ['KeyC'],
        power: ['KeyV'],
        interact: ['KeyE'],
        emote1: ['Digit1', 'Numpad1'],
        emote2: ['Digit2', 'Numpad2'],
        emote3: ['Digit3', 'Numpad3'],
        emote4: ['Digit4', 'Numpad4'],
        mute: ['KeyM'],
        help: ['KeyH']
    };

    // keys that can't be bound: they belong to the browser / the screens themselves
    const RESERVED = /^(Escape|Tab|F\d{1,2}|MetaLeft|MetaRight|OSLeft|OSRight|ContextMenu|PrintScreen|ScrollLock|Pause|CapsLock|NumLock|Unidentified)$/;

    const FALLBACK_KEYS = 'QWERTYUIOPASDFGHJKLZXCVBNM'.split('').map(c => 'Key' + c);

    const isValidCode = (c) => typeof c === 'string' && /^[A-Za-z0-9]{1,20}$/.test(c) && !RESERVED.test(c);
    const ids = ACTIONS.map(a => a.id);

    function defaults() {
        const out = {};
        for (const id of ids) out[id] = [...DEFAULTS[id]];
        return out;
    }

    // Accepts anything (e.g. what localStorage held) and returns valid, conflict-free bindings.
    // A key can only do one thing: if two actions claim it, the earlier one keeps it.
    function sanitize(raw) {
        const src = raw && typeof raw === 'object' ? raw : {};
        const out = {};
        const used = new Set();
        for (const id of ids) {
            const wanted = Array.isArray(src[id]) ? src[id] : (id in src ? [] : DEFAULTS[id]);
            const keys = [];
            for (const c of wanted) {
                if (keys.length >= SLOTS) break;
                if (isValidCode(c) && !used.has(c)) { keys.push(c); used.add(c); }
            }
            out[id] = keys;
        }
        // a core action left with no keys falls back to its defaults (those still free), and if
        // even those are taken, to the first free letter key: you can always play
        for (const a of ACTIONS) {
            if (!a.core || out[a.id].length > 0) continue;
            for (const c of DEFAULTS[a.id]) if (!used.has(c)) { out[a.id].push(c); used.add(c); }
            if (out[a.id].length === 0) {
                const free = FALLBACK_KEYS.find(c => !used.has(c));
                if (free) { out[a.id].push(free); used.add(free); }
            }
        }
        return out;
    }

    // Put `code` on `action` in `slot` (0..2), taking it away from whatever else used it.
    // Returns { bindings, displaced: [actionIds that lost the key] }. code === null clears the slot.
    function setKey(bindings, action, slot, code) {
        const next = {};
        for (const id of ids) next[id] = [...bindings[id]];
        const displaced = [];
        if (!ids.includes(action) || slot < 0 || slot >= SLOTS) return { bindings: next, displaced };

        if (code !== null) {
            if (!isValidCode(code)) return { bindings: next, displaced };
            for (const id of ids) {
                if (id === action) continue;
                const at = next[id].indexOf(code);
                if (at >= 0) { next[id].splice(at, 1); displaced.push(id); }
            }
            // already on this action in another slot: move it
            const mine = next[action].indexOf(code);
            if (mine >= 0) next[action].splice(mine, 1);
            next[action][Math.min(slot, next[action].length)] = code;
            // keep slot positions meaningful: replace what was there if we are overwriting
        } else {
            next[action].splice(slot, 1);
        }
        next[action] = next[action].filter(Boolean).slice(0, SLOTS);
        return { bindings: next, displaced };
    }

    // which action a pressed key triggers (null if none)
    function actionOf(bindings, code) {
        for (const id of ids) if (bindings[id].includes(code)) return id;
        return null;
    }

    const LABELS = {
        ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Enter: 'Enter',
        ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
        AltLeft: 'Alt', AltRight: 'Alt', Backspace: 'Bksp', Delete: 'Del', Insert: 'Ins',
        Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', NumpadAdd: 'Num +', NumpadSubtract: 'Num -',
        NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .', NumpadEnter: 'Num Enter'
    };

    function label(code) {
        if (!code) return '—';
        if (LABELS[code]) return LABELS[code];
        let m = /^Key([A-Z])$/.exec(code); if (m) return m[1];
        m = /^Digit(\d)$/.exec(code); if (m) return m[1];
        m = /^Numpad(\d)$/.exec(code); if (m) return 'Num ' + m[1];
        return code;
    }

    return { SLOTS, ACTIONS, DEFAULTS, defaults, sanitize, setKey, actionOf, label, isValidCode };
});
