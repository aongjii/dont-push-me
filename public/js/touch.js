// On-screen controls for phones and tablets. They drive the very same `inputState` the keyboard
// does, so everything else (prediction, commands to the server) is unchanged.
const TouchUI = (() => {
    const params = new URLSearchParams(location.search);
    const isTouch = params.has('touch') ||
        (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
        'ontouchstart' in window;
    if (!isTouch) return { enabled: false, onPower() {} };

    document.body.classList.add('touch');
    const root = document.getElementById('touch-controls');

    const hold = (key, down) => { inputState[key] = down; };

    // ---- left/right pad: one finger can slide between the two sides
    const pad = document.getElementById('tc-pad');
    let padPointer = null;

    function padUpdate(e) {
        const r = pad.getBoundingClientRect();
        const x = e.clientX - r.left;
        const left = x < r.width / 2;
        hold('left', left);
        hold('right', !left);
        pad.classList.toggle('left', left);
        pad.classList.toggle('right', !left);
    }

    function padRelease() {
        padPointer = null;
        hold('left', false);
        hold('right', false);
        pad.classList.remove('left', 'right');
    }

    pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        padPointer = e.pointerId;
        try { pad.setPointerCapture(e.pointerId); } catch (err) {}
        padUpdate(e);
    });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === padPointer) padUpdate(e); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t =>
        pad.addEventListener(t, (e) => { if (e.pointerId === padPointer) padRelease(); }));

    // ---- action buttons: held while touched
    function bindHold(id, key) {
        const el = document.getElementById(id);
        let active = null;
        el.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            active = e.pointerId;
            try { el.setPointerCapture(e.pointerId); } catch (err) {}
            hold(key, true);
            el.classList.add('down');
        });
        const release = (e) => {
            if (e.pointerId !== active) return;
            active = null;
            hold(key, false);
            el.classList.remove('down');
        };
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => el.addEventListener(t, release));
        return el;
    }

    bindHold('tc-jump', 'jump');
    bindHold('tc-push', 'push');
    bindHold('tc-pull', 'pull');
    bindHold('tc-inhale', 'inhale');
    const powerBtn = bindHold('tc-power', 'power');

    // ---- emotes: a button opens a small row of four
    const emoteBtn = document.getElementById('tc-emote');
    const emotePanel = document.getElementById('tc-emotes');
    emoteBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        emotePanel.classList.toggle('open');
    });
    emotePanel.querySelectorAll('button').forEach((b, i) => {
        b.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            socket.emit('emote', i);
            emotePanel.classList.remove('open');
        });
    });

    // ---- fullscreen (hides the browser bars; also asks for landscape where allowed)
    const fsBtn = document.getElementById('btn-fullscreen');
    if (document.documentElement.requestFullscreen) {
        fsBtn.style.display = 'flex';
        fsBtn.addEventListener('click', async () => {
            try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else {
                    await document.documentElement.requestFullscreen();
                    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
                }
            } catch (err) {}
        });
    }

    // never leave a button stuck if the page loses focus
    window.addEventListener('blur', () => { padRelease(); });

    return {
        enabled: true,
        // the power button shows what you hold and only works when you hold something
        onPower(power) {
            const usable = power && power !== 'wings';
            powerBtn.classList.toggle('ready', !!usable);
            powerBtn.classList.toggle('passive', power === 'wings');
            const names = { fire: 'fire', ice: 'ice', spin: 'spin', wings: 'wings' };
            Icons.set(powerBtn, names[power] || 'star', 30);
        }
    };
})();
