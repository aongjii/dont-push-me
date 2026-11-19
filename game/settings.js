// Room settings the host can change in the waiting room. Everything is validated here, so a
// client can only ever pick from these options.
const OPTIONS = {
    mode: ['race', 'survival'],
    rounds: [1, 2, 3, 4, 5, 6, 7, 8], // how many levels one match lasts
    lives: [1, 3],
    items: [true, false],
    shuffle: [true, false]
};

const DEFAULTS = { mode: 'race', rounds: 3, lives: 3, items: true, shuffle: false };

function sanitizeSettings(raw, current = DEFAULTS) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const out = { ...current };
    for (const key of Object.keys(OPTIONS)) {
        if (key in s && OPTIONS[key].includes(s[key])) out[key] = s[key];
    }
    return out;
}

module.exports = { OPTIONS, DEFAULTS, sanitizeSettings };
