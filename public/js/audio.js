// Sound effects and background music, synthesised with the Web Audio API
// (no audio files to download). Browsers block audio until the first user gesture,
// so the AudioContext is created lazily on the first key press or click.
const Sfx = (() => {
    let ctx = null;
    let master = null;
    let musicTimer = null;
    let musicStep = 0;
    let muted = false;
    let scale = 1; // volume multiplier for the effect being played (distance fall-off)
    try { muted = localStorage.getItem('dpm-muted') === '1'; } catch (e) {}

    function ensure() {
        if (ctx) {
            if (ctx.state === 'suspended') ctx.resume();
            return ctx;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(ctx.destination);
        return ctx;
    }

    // One enveloped oscillator note
    function tone({ freq, freqEnd, dur = 0.15, type = 'square', vol = 0.2, delay = 0 }) {
        if (!ensure() || muted) return;
        const t0 = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * scale), t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }

    function noise({ dur = 0.15, vol = 0.2, filter = 1200, delay = 0 }) {
        if (!ensure() || muted) return;
        const t0 = ctx.currentTime + delay;
        const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = filter;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(Math.max(0.0002, vol * scale), t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(lp);
        lp.connect(gain);
        gain.connect(master);
        src.start(t0);
    }

    // --- Effects ---
    const effects = {
        push:   () => { noise({ dur: 0.12, vol: 0.35, filter: 900 }); tone({ freq: 220, freqEnd: 70, dur: 0.18, type: 'sawtooth', vol: 0.25 }); },
        pull:   () => { tone({ freq: 300, freqEnd: 700, dur: 0.22, type: 'sine', vol: 0.22 }); tone({ freq: 450, freqEnd: 900, dur: 0.22, type: 'sine', vol: 0.12, delay: 0.04 }); },
        free:   () => { tone({ freq: 500, freqEnd: 900, dur: 0.1, type: 'triangle', vol: 0.2 }); },
        switch: () => { tone({ freq: 140, dur: 0.05, type: 'square', vol: 0.25 }); tone({ freq: 260, dur: 0.08, type: 'square', vol: 0.2, delay: 0.06 }); },
        death:  () => { tone({ freq: 440, freqEnd: 60, dur: 0.55, type: 'sawtooth', vol: 0.25 }); noise({ dur: 0.25, vol: 0.2, filter: 600, delay: 0.1 }); },
        ko:     () => { tone({ freq: 523, dur: 0.1, type: 'square', vol: 0.2 }); tone({ freq: 784, dur: 0.18, type: 'square', vol: 0.2, delay: 0.1 }); },
        finish: () => { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.18, type: 'triangle', vol: 0.25, delay: i * 0.09 })); },
        tick:   () => { tone({ freq: 660, dur: 0.12, type: 'sine', vol: 0.25 }); },
        go:     () => { tone({ freq: 990, dur: 0.35, type: 'sine', vol: 0.3 }); },
        emote:  () => { tone({ freq: 880, freqEnd: 1320, dur: 0.08, type: 'sine', vol: 0.15 }); },
        jump:   () => { tone({ freq: 280, freqEnd: 520, dur: 0.12, type: 'square', vol: 0.08 }); },
        land:   () => { noise({ dur: 0.06, vol: 0.12, filter: 500 }); },
        hurry:  () => { tone({ freq: 880, dur: 0.07, type: 'square', vol: 0.15 }); },
        swallow:() => { tone({ freq: 700, freqEnd: 180, dur: 0.18, type: 'sine', vol: 0.28 }); tone({ freq: 150, dur: 0.1, type: 'triangle', vol: 0.3, delay: 0.17 }); },
        spit:   () => { noise({ dur: 0.1, vol: 0.3, filter: 2500 }); tone({ freq: 220, freqEnd: 900, dur: 0.14, type: 'square', vol: 0.18 }); },
        power:  () => { [392, 523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.1, type: 'square', vol: 0.16, delay: i * 0.06 })); },
        fire:   () => { noise({ dur: 0.22, vol: 0.3, filter: 1800 }); tone({ freq: 160, freqEnd: 90, dur: 0.2, type: 'sawtooth', vol: 0.15 }); },
        ice:    () => { tone({ freq: 1800, freqEnd: 900, dur: 0.25, type: 'triangle', vol: 0.18 }); tone({ freq: 2400, freqEnd: 1200, dur: 0.2, type: 'sine', vol: 0.1, delay: 0.05 }); },
        whirl:  () => { tone({ freq: 300, freqEnd: 800, dur: 0.35, type: 'sawtooth', vol: 0.14 }); tone({ freq: 800, freqEnd: 300, dur: 0.35, type: 'sawtooth', vol: 0.1, delay: 0.3 }); },
        flap:   () => { noise({ dur: 0.07, vol: 0.12, filter: 3000 }); },
        bounce: () => { tone({ freq: 220, freqEnd: 760, dur: 0.22, type: 'sine', vol: 0.28 }); tone({ freq: 330, freqEnd: 1100, dur: 0.18, type: 'triangle', vol: 0.12, delay: 0.03 }); },
        arrow:  () => { noise({ dur: 0.14, vol: 0.2, filter: 3500 }); tone({ freq: 1200, freqEnd: 500, dur: 0.14, type: 'triangle', vol: 0.1 }); },
        rock:   () => { tone({ freq: 90, freqEnd: 45, dur: 0.25, type: 'sine', vol: 0.3 }); noise({ dur: 0.18, vol: 0.18, filter: 500 }); },
        fireball: () => { noise({ dur: 0.3, vol: 0.22, filter: 1500 }); tone({ freq: 200, freqEnd: 120, dur: 0.28, type: 'sawtooth', vol: 0.1 }); },
        crumble:() => { noise({ dur: 0.35, vol: 0.28, filter: 700 }); noise({ dur: 0.2, vol: 0.2, filter: 400, delay: 0.12 }); },
        rumble: () => { noise({ dur: 0.1, vol: 0.12, filter: 350 }); },
        warn:   () => { tone({ freq: 520, dur: 0.05, type: 'square', vol: 0.07 }); },
        win:    () => { [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.2, type: 'triangle', vol: 0.25, delay: i * 0.12 })); }
    };

    // --- Music: a short looping bass + arpeggio, a different mood for each level theme ---
    const MUSIC = {
        meadow:  { ms: 230, bass: [110, 110, 110, 110, 87.3, 87.3, 98, 98],     arp: [440, 523, 659, 523, 440, 523, 698, 587], lead: 'square',   bassType: 'triangle' },
        candy:   { ms: 200, bass: [131, 131, 196, 196, 175, 175, 196, 196],     arp: [523, 659, 784, 659, 523, 659, 880, 784], lead: 'triangle', bassType: 'triangle' },
        volcano: { ms: 250, bass: [73.4, 73.4, 73.4, 87.3, 73.4, 73.4, 65.4, 82.4], arp: [294, 349, 311, 294, 262, 294, 349, 392], lead: 'sawtooth', bassType: 'sawtooth' },
        dusk:    { ms: 300, bass: [98, 98, 110, 110, 87.3, 87.3, 98, 110],     arp: [392, 494, 587, 494, 440, 523, 587, 494], lead: 'sine',     bassType: 'triangle' },
        night:   { ms: 260, bass: [82.4, 82.4, 98, 82.4, 73.4, 73.4, 98, 82.4], arp: [330, 311, 330, 392, 294, 277, 311, 247], lead: 'square',   bassType: 'sine' }
    };
    let musicTheme = 'meadow';

    function musicTick() {
        const m = MUSIC[musicTheme] || MUSIC.meadow;
        const i = musicStep % 8;
        tone({ freq: m.bass[i], dur: m.ms / 1000 * 0.9, type: m.bassType, vol: 0.12 });
        if (i % 2 === 0) tone({ freq: m.arp[i], dur: 0.12, type: m.lead, vol: m.lead === 'sawtooth' ? 0.03 : 0.04 });
        musicStep++;
    }

    return {
        // `vol` (0..1) scales the loudness, e.g. for something happening far away
        play(name, vol = 1) {
            const fn = effects[name];
            if (!fn) return;
            scale = Math.max(0, Math.min(1, vol));
            if (scale > 0.02) fn();
            scale = 1;
        },
        startMusic(theme) {
            const next = MUSIC[theme] ? theme : 'meadow';
            if (musicTimer && next === musicTheme) return;
            if (musicTimer) clearInterval(musicTimer);
            musicTheme = next;
            musicStep = 0;
            musicTimer = setInterval(musicTick, MUSIC[musicTheme].ms);
        },
        stopMusic() {
            if (musicTimer) clearInterval(musicTimer);
            musicTimer = null;
        },
        unlock() { ensure(); },
        isMuted() { return muted; },
        setMuted(value) {
            muted = !!value;
            try { localStorage.setItem('dpm-muted', muted ? '1' : '0'); } catch (e) {}
            if (master) master.gain.value = muted ? 0 : 0.5;
        },
        toggleMute() { this.setMuted(!muted); return muted; }
    };
})();

// Browsers only allow audio after a user gesture
['keydown', 'pointerdown'].forEach(evt =>
    window.addEventListener(evt, () => Sfx.unlock(), { once: true }));
