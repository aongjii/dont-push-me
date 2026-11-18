// The dress-up screen: pick colour, face, hat and accessory with a live preview.
// The choice is remembered in this browser (localStorage) and sent to the server when you
// create/join a room, or change it in the waiting room.
const SkinUI = (() => {
    const STORAGE_KEY = 'dpm-skin';
    const TABS = [
        { id: 'color', label: 'สี' },
        { id: 'face', label: 'หน้า' },
        { id: 'hat', label: 'หมวก' },
        { id: 'acc', label: 'ของตกแต่ง' }
    ];

    let skin = load();
    let tab = 'color';
    let taken = [];            // colours other players in the room already use
    let onChange = () => {};
    let previewRenderer = null;
    let previewTimer = null;

    const overlay = document.getElementById('skin-overlay');
    const grid = document.getElementById('skin-grid');
    const tabsEl = document.getElementById('skin-tabs');
    const noteEl = document.getElementById('skin-note');
    const nameEl = document.getElementById('skin-summary');

    function load() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (raw) return Skins.sanitizeSkin(raw);
        } catch (e) {}
        return Skins.randomSkin();
    }

    function save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(skin)); } catch (e) {}
    }

    const nameOf = (list, id) => (list.find(o => o.id === id) || {}).name || '';
    const isTaken = (hex) => taken.some(c => c.toUpperCase() === hex.toUpperCase());

    function renderTabs() {
        tabsEl.innerHTML = '';
        TABS.forEach(t => {
            const b = document.createElement('button');
            b.textContent = t.label;
            b.className = 'skin-tab' + (t.id === tab ? ' active' : '');
            b.addEventListener('click', () => { tab = t.id; renderTabs(); renderGrid(); });
            tabsEl.appendChild(b);
        });
    }

    function renderGrid() {
        grid.innerHTML = '';
        grid.className = 'skin-grid skin-grid-' + tab;

        if (tab === 'color') {
            Skins.COLORS.forEach(c => {
                const b = document.createElement('button');
                const used = isTaken(c.hex) && c.hex.toUpperCase() !== skin.color.toUpperCase();
                b.className = 'swatch' + (c.hex === skin.color ? ' selected' : '') + (used ? ' taken' : '');
                b.style.background = c.hex;
                b.title = used ? `${c.name} (มีคนใช้แล้ว)` : c.name;
                b.disabled = used;
                if (used) b.textContent = '✕';
                b.addEventListener('click', () => choose('color', c.hex));
                grid.appendChild(b);
            });
            return;
        }

        const list = tab === 'face' ? Skins.FACES : tab === 'hat' ? Skins.HATS : Skins.ACCS;
        list.forEach(item => {
            const b = document.createElement('button');
            b.className = 'skin-option' + (skin[tab] === item.id ? ' selected' : '');
            const cv = document.createElement('canvas');
            cv.width = 68; cv.height = 68;
            const variant = { ...skin, [tab]: item.id };
            new Renderer(cv).drawPortrait(variant, skin.color, 1.2);
            const label = document.createElement('span');
            label.textContent = item.name;
            b.appendChild(cv);
            b.appendChild(label);
            b.addEventListener('click', () => choose(tab, item.id));
            grid.appendChild(b);
        });
    }

    function summary() {
        nameEl.textContent = [
            nameOf(Skins.COLORS.map(c => ({ id: c.hex, name: c.name })), skin.color),
            nameOf(Skins.FACES, skin.face),
            skin.hat !== 'none' ? nameOf(Skins.HATS, skin.hat) : '',
            skin.acc !== 'none' ? nameOf(Skins.ACCS, skin.acc) : ''
        ].filter(Boolean).join(' • ');
    }

    function choose(part, value) {
        if (skin[part] === value) return;
        skin = { ...skin, [part]: value };
        save();
        noteEl.textContent = '';
        refresh();
        onChange(skin);
    }

    function refresh() {
        renderGrid();
        summary();
    }

    function startPreview() {
        if (!previewRenderer) previewRenderer = new Renderer('skin-preview');
        if (previewTimer) return;
        const t0 = performance.now();
        const loop = () => {
            const t = (performance.now() - t0) / 1000;
            // a little hop every couple of seconds so the animation is visible
            previewRenderer.drawPortrait(skin, skin.color, t, 'normal');
            previewTimer = requestAnimationFrame(loop);
        };
        previewTimer = requestAnimationFrame(loop);
    }

    function stopPreview() {
        if (previewTimer) cancelAnimationFrame(previewTimer);
        previewTimer = null;
    }

    function open() {
        overlay.classList.add('active');
        renderTabs();
        refresh();
        startPreview();
    }

    function close() {
        overlay.classList.remove('active');
        stopPreview();
    }

    document.querySelectorAll('.btn-skin').forEach(b => b.addEventListener('click', open));
    document.getElementById('btn-skin-done').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('btn-skin-random').addEventListener('click', () => {
        // keep the colour valid for this room
        let next = Skins.randomSkin();
        let tries = 0;
        while (isTaken(next.color) && tries++ < 30) next = Skins.randomSkin();
        skin = next;
        save();
        refresh();
        onChange(skin);
    });

    return {
        current: () => ({ ...skin }),
        isOpen: () => overlay.classList.contains('active'),
        close,
        onChange: (fn) => { onChange = fn; },
        // The server may change our colour (someone else has it): follow its decision
        setFromServer(mine, others) {
            taken = others || [];
            if (mine) {
                const next = Skins.sanitizeSkin(mine);
                const colorChanged = next.color.toUpperCase() !== skin.color.toUpperCase();
                skin = next;
                save();
                if (colorChanged) noteEl.textContent = 'สีที่เลือกมีคนใช้แล้ว ระบบเปลี่ยนให้เป็นสีที่ว่างอยู่';
            }
            if (overlay.classList.contains('active')) refresh();
        }
    };
})();
