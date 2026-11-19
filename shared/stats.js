// Player statistics kept in this browser (localStorage); nothing is sent to the server.
// UMD: require() in Node, window.Stats in the browser. Storage is injected so it can be tested.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Stats = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const KEY = 'dpm-stats';
    // every counter we keep, with the label shown on the stats screen
    const COUNTERS = [
        { id: 'rounds',     name: 'ด่านที่เล่น' },
        { id: 'finishes',   name: 'เข้าเส้นชัย' },
        { id: 'roundWins',  name: 'ชนะด่าน (ได้แต้มสูงสุด)' },
        { id: 'matchWins',  name: 'ชนะทั้งเกม' },
        { id: 'kos',        name: 'ส่งคนลงเหว' },
        { id: 'swallows',   name: 'กลืนเพื่อน' },
        { id: 'deaths',     name: 'ตาย' },
        { id: 'tutorials',  name: 'ผ่านด่านฝึกเล่น' }
    ];

    function create(storage) {
        let data = { counters: {}, best: {} };
        try {
            const raw = storage && JSON.parse(storage.getItem(KEY));
            if (raw && typeof raw === 'object') {
                for (const c of COUNTERS) {
                    const v = raw.counters && raw.counters[c.id];
                    if (Number.isFinite(v) && v >= 0) data.counters[c.id] = Math.floor(v);
                }
                for (const [k, v] of Object.entries(raw.best || {})) if (Number.isFinite(v) && v > 0) data.best[k] = v;
            }
        } catch (e) { /* corrupt or unavailable: start fresh */ }

        const save = () => { try { storage && storage.setItem(KEY, JSON.stringify(data)); } catch (e) {} };

        return {
            counters: () => ({ ...Object.fromEntries(COUNTERS.map(c => [c.id, 0])), ...data.counters }),
            add(id, n = 1) {
                if (!COUNTERS.some(c => c.id === id)) return;
                data.counters[id] = (data.counters[id] || 0) + n;
                save();
            },
            // fastest finish time (ms) per level; returns true when it is a new record
            recordTime(level, ms) {
                if (!(ms > 0)) return false;
                const k = String(level);
                if (data.best[k] === undefined || ms < data.best[k]) { data.best[k] = Math.round(ms); save(); return true; }
                return false;
            },
            best: () => ({ ...data.best }),
            reset() { data = { counters: {}, best: {} }; save(); }
        };
    }

    return { KEY, COUNTERS, create };
});
