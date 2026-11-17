// Sound effects and background music, synthesised with the Web Audio API
// (no audio files to download). Browsers block audio until the first user gesture,
// so the AudioContext is created lazily on the first key press or click.
const Sfx = (() => {
    let ctx = null;
    let master = null;
    let musicTimer = null;
    let musicStep = 0;
    let muted = false;
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
        gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
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
        gain.gain.setValueAtTime(vol, t0);
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
        win:    () => { [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.2, type: 'triangle', vol: 0.25, delay: i * 0.12 })); }
    };

    // --- Music: a short looping bass + arpeggio ---
    const BASS = [110, 110, 110, 110, 87.3, 87.3, 98, 98];          // A2 A2 .. F2 F2 G2 G2
    const ARP  = [440, 523, 659, 523, 440, 523, 698, 587];

    function musicTick() {
        const i = musicStep % 8;
        tone({ freq: BASS[i], dur: 0.2, type: 'triangle', vol: 0.12 });
        if (i % 2 === 0) tone({ freq: ARP[i], dur: 0.12, type: 'square', vol: 0.04 });
        musicStep++;
    }

    return {
        play(name) {
            const fn = effects[name];
            if (fn) fn();
        },
        startMusic() {
            if (musicTimer) return;
            musicStep = 0;
            musicTimer = setInterval(musicTick, 230);
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
