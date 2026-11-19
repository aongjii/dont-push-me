// The "set your keys" screen, and the single place the game asks "what does this key do?".
// Bindings live in this browser (localStorage); the logic is in shared/keybinds.js.
const KeysUI = (() => {
    const STORAGE_KEY = 'dpm-keys';
    let bindings = load();
    let capture = null;           // { action, slot } while waiting for a key press
    const listeners = [];

    const overlay = document.getElementById('keys-overlay');
    const list = document.getElementById('keys-list');
    const note = document.getElementById('keys-note');

    function load() {
        try { return Keybinds.sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
        catch (e) { return Keybinds.defaults(); }
    }

    function save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch (e) {}
    }

    const actionName = (id) => (Keybinds.ACTIONS.find(a => a.id === id) || {}).name || id;

    // label of the first key bound to an action (what to tell the player to press)
    function keyName(action, slot = 0) {
        return Keybinds.label(bindings[action][slot]);
    }

    // every <kbd data-act="push"> / <span data-act="..."> in the page shows the live binding
    function refreshLabels() {
        document.querySelectorAll('[data-act]').forEach(el => {
            const slot = parseInt(el.dataset.slot || '0', 10);
            el.textContent = keyName(el.dataset.act, slot);
        });
        listeners.forEach(fn => fn());
    }

    function render() {
        list.innerHTML = '';
        Keybinds.ACTIONS.forEach(a => {
            const row = document.createElement('div');
            row.className = 'key-row';
            const name = document.createElement('span');
            name.className = 'key-name';
            name.textContent = a.name;
            row.appendChild(name);

            const slots = document.createElement('span');
            slots.className = 'key-slots';
            for (let s = 0; s < Keybinds.SLOTS; s++) {
                const b = document.createElement('button');
                const listening = capture && capture.action === a.id && capture.slot === s;
                b.className = 'key-slot' + (listening ? ' listening' : '') + (bindings[a.id][s] ? '' : ' empty');
                b.textContent = listening ? 'กดปุ่ม...' : Keybinds.label(bindings[a.id][s]);
                b.addEventListener('click', () => { capture = { action: a.id, slot: s }; note.textContent = ''; render(); });
                slots.appendChild(b);
            }
            row.appendChild(slots);
            list.appendChild(row);
        });
    }

    function apply(next) {
        bindings = next;
        save();
        render();
        refreshLabels();
    }

    // While a slot is waiting for a key, take over the keyboard
    window.addEventListener('keydown', (e) => {
        if (!capture) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const { action, slot } = capture;
        capture = null;

        if (e.code === 'Escape') { render(); return; }
        if (e.code === 'Backspace' || e.code === 'Delete') {
            apply(Keybinds.setKey(bindings, action, slot, null).bindings);
            return;
        }
        if (!Keybinds.isValidCode(e.code)) {
            note.textContent = 'ปุ่มนี้ใช้ไม่ได้ (เป็นปุ่มของเบราว์เซอร์/ระบบ) ลองปุ่มอื่น';
            render();
            return;
        }
        const r = Keybinds.setKey(bindings, action, slot, e.code);
        const lost = r.displaced.map(actionName);
        const empty = r.displaced.filter(id => r.bindings[id].length === 0).map(actionName);
        note.textContent = lost.length
            ? `ปุ่ม ${Keybinds.label(e.code)} เคยใช้กับ "${lost.join(', ')}" ย้ายมาที่ "${actionName(action)}" แล้ว` +
              (empty.length ? ` — "${empty.join(', ')}" ยังไม่มีปุ่ม อย่าลืมตั้งใหม่` : '')
            : '';
        apply(r.bindings);
    }, true);

    function open() {
        capture = null;
        note.textContent = '';
        if (typeof clearInputs === 'function') clearInputs();
        overlay.classList.add('active');
        render();
    }

    function close() {
        capture = null;
        // an action left without any key gets one automatically, so you can always play
        const empty = Keybinds.ACTIONS.filter(a => a.core && bindings[a.id].length === 0);
        const fixed = Keybinds.sanitize(bindings);
        apply(fixed);
        overlay.classList.remove('active');
        if (empty.length && typeof UI !== 'undefined') {
            UI.showError(empty.map(a => `"${a.name}" ไม่มีปุ่ม ระบบตั้งเป็นปุ่ม ${Keybinds.label(fixed[a.id][0])} ให้แล้ว`).join('\n'));
        }
    }

    document.querySelectorAll('.btn-keys').forEach(b => b.addEventListener('click', open));
    document.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('.open-keys-link')) { e.preventDefault(); open(); }
    });
    document.getElementById('btn-keys-done').addEventListener('click', close);
    document.getElementById('btn-keys-reset').addEventListener('click', () => { note.textContent = ''; apply(Keybinds.defaults()); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    refreshLabels();

    return {
        actionOf: (code) => Keybinds.actionOf(bindings, code),
        keyName,
        isCapturing: () => !!capture,
        isOpen: () => overlay.classList.contains('active'),
        close,
        onChange: (fn) => listeners.push(fn),
        refreshLabels
    };
})();
