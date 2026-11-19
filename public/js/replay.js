// Highlights replay: the browser keeps the last few seconds of what it received and, when something
// fun happens (a stomp, a knock-out, a fall, the first finisher), saves a clip. After the round you
// can watch the clips again. Nothing leaves your browser.
const Replay = (() => {
    const FRAME_EVERY = 2;       // keep every 2nd snapshot (~15 per second)
    const CLIP_FRAMES = 75;      // ~5 seconds
    const MAX_CLIPS = 6;
    const FRAME_MS = 1000 / 15;

    let buf = [];
    let counter = 0;
    let clips = [];
    let active = false;
    let idx = 0;
    let startedAt = 0;
    let raf = 0;

    const bar = document.getElementById('replay-bar');
    const label = document.getElementById('replay-label');
    const openBtn = document.getElementById('btn-replay');

    function refreshButton() {
        openBtn.style.display = clips.length ? '' : 'none';
        openBtn.querySelector('span').textContent = `ดูช่วงเด็ด (${clips.length})`;
    }

    return {
        get active() { return active; },
        clear() { buf = []; clips = []; counter = 0; refreshButton(); },
        record(state) {
            if (++counter % FRAME_EVERY) return;
            buf.push(state);
            if (buf.length > 90) buf.shift();
        },
        // something worth keeping just happened: save the clip a moment later so it includes the aftermath
        mark(text, focusId) {
            setTimeout(() => {
                const frames = buf.slice(-CLIP_FRAMES);
                if (frames.length < 15) return;
                const last = clips[clips.length - 1];
                if (last && last.text === text && Date.now() - last.at < 4000) return;
                clips.push({ text, focusId, frames, at: Date.now() });
                if (clips.length > MAX_CLIPS) clips.shift();
                refreshButton();
            }, 1200);
        },
        count: () => clips.length,

        open(n = 0) {
            if (!clips.length) return;
            idx = (n + clips.length) % clips.length;
            active = true;
            startedAt = performance.now();
            document.body.classList.add('replaying');
            UI.showScreen('game');
            bar.style.display = 'flex';
            label.textContent = `${clips[idx].text}  (${idx + 1}/${clips.length})`;
            const loop = (now) => {
                if (!active) return;
                const clip = clips[idx];
                const total = clip.frames.length * FRAME_MS + 900;      // hold the last frame briefly, then loop
                const t = (now - startedAt) % total;
                const frame = clip.frames[Math.min(clip.frames.length - 1, Math.floor(t / FRAME_MS))];
                renderer.draw(frame, clip.focusId, levelData, 1 / 60, clip.focusId);
                raf = requestAnimationFrame(loop);
            };
            raf = requestAnimationFrame(loop);
        },
        step(dir) { if (active) this.open(idx + dir); },
        close() {
            active = false;
            cancelAnimationFrame(raf);
            bar.style.display = 'none';
            document.body.classList.remove('replaying');
            UI.showScreen('roundEnd');
        }
    };
})();

document.getElementById('btn-replay').addEventListener('click', () => Replay.open(0));
document.getElementById('btn-replay-prev').addEventListener('click', () => Replay.step(-1));
document.getElementById('btn-replay-next').addEventListener('click', () => Replay.step(1));
document.getElementById('btn-replay-close').addEventListener('click', () => Replay.close());
