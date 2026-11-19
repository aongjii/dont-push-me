// Your personal statistics: kept in this browser only, shown on the "สถิติ" screen, and used
// to unlock cosmetics (see Skins.UNLOCKS).
const PlayerStats = (() => {
    let store = null;
    try { store = window.localStorage; } catch (e) { /* private mode: stats just won't persist */ }
    const stats = Stats.create(store);
    let onUnlock = () => {};

    const overlay = document.getElementById('stats-overlay');
    const partName = { hat: 'หมวก', acc: 'ของตกแต่ง', pat: 'ลาย' };
    const catalog = { hat: Skins.HATS, acc: Skins.ACCS, pat: Skins.PATTERNS };

    function row(label, value, done) {
        const el = document.createElement('div');
        el.className = 'stats-row' + (done ? ' done' : '');
        const l = document.createElement('span'); l.textContent = label;
        const v = document.createElement('b'); v.textContent = value;
        el.append(l, v);
        return el;
    }

    function render() {
        const c = stats.counters();
        const list = document.getElementById('stats-list');
        list.replaceChildren(...Stats.COUNTERS.map(k => row(k.name, c[k.id])));

        const best = stats.best();
        const keys = Object.keys(best).sort();
        document.getElementById('stats-best').replaceChildren(...(keys.length
            ? keys.map(k => row(k === 'tutorial' ? 'ด่านฝึกเล่น' : `ด่าน ${k}`, `${(best[k] / 1000).toFixed(1)} วินาที`))
            : [row('ยังไม่มีสถิติ ลองเข้าเส้นชัยดู', '-')]));

        const unlocks = [];
        for (const part of Object.keys(Skins.UNLOCKS)) {
            for (const [id, u] of Object.entries(Skins.UNLOCKS[part])) {
                const name = (catalog[part].find(o => o.id === id) || {}).name || id;
                const have = Math.min(c[u.stat] || 0, u.n);
                unlocks.push(row(`${partName[part]}: ${name} (${u.text})`, `${have}/${u.n}`, have >= u.n));
            }
        }
        document.getElementById('stats-unlocks').replaceChildren(...unlocks);
    }

    function setOpen(v) {
        if (v) render();
        overlay.classList.toggle('active', v);
    }
    document.getElementById('btn-stats').addEventListener('click', () => setOpen(true));
    document.getElementById('btn-stats-close').addEventListener('click', () => setOpen(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) setOpen(false); });

    return {
        counters: () => stats.counters(),
        add(id, n = 1) {
            const before = Skins.unlockedList(stats.counters());
            stats.add(id, n);
            const fresh = Skins.unlockedList(stats.counters()).filter(x => !before.includes(x));
            if (fresh.length) onUnlock(fresh.map(key => {
                const [part, id2] = key.split(':');
                return (catalog[part].find(o => o.id === id2) || {}).name || id2;
            }));
        },
        recordTime: (level, ms) => stats.recordTime(level, ms),
        set onUnlock(fn) { onUnlock = fn; }
    };
})();
